/**
 * lib/schoolGuardianCore.ts — منطقِ مشترکِ «اتصالِ والد با شمارهٔ دانش‌آموز» برایِ سایت (routes/schoolGuardianRequests.ts)
 * و باتِ تلگرام (lib/schoolBot/*). قواعد فقط یک‌جا: سقفِ ۳ ارسال برایِ هر شماره، ۱۰ شمارهٔ متفاوت در ۲۴ ساعت،
 * پاسخِ خنثیِ یکسان، ۷ روز اعتبار، تأییدِ idempotent. (شرح کاملِ قواعد: بالایِ routes/schoolGuardianRequests.ts)
 */
import crypto from "crypto";
import { and, eq, inArray, sql, count } from "drizzle-orm";
import { db, schoolGuardianRequestsTable, schoolGuardianshipsTable, schoolMembersTable, usersTable } from "@workspace/db";
import { normalizeGuardianPhone, phoneVariants } from "./guardianPhone";
import { notifySchoolUsers } from "./schoolNotify";
import { logSchoolAudit } from "./schoolAuditLog";
import { logger } from "./logger";

export const GUARDIAN_PER_PHONE_LIMIT = 3;
export const GUARDIAN_DAILY_PHONE_LIMIT = 10;
export const GUARDIAN_EXPIRY_DAYS = 7;
export const GUARDIAN_NEUTRAL_MESSAGE = "اگر این شماره متعلق به یک دانش‌آموز این مدرسه باشد، درخواست برای او ارسال شد";

class LimitError extends Error { constructor(public code: string) { super(code); } }

/** pending هایِ قدیمی‌تر از ۷ روز → expired (قبل از هر خواندن/تصمیم). */
export async function expireStaleGuardianRequests(schoolId: string) {
  await db.update(schoolGuardianRequestsTable)
    .set({ status: "expired", decidedAt: new Date() })
    .where(and(
      eq(schoolGuardianRequestsTable.schoolId, schoolId),
      eq(schoolGuardianRequestsTable.status, "pending"),
      sql`${schoolGuardianRequestsTable.createdAt} < now() - make_interval(days => ${GUARDIAN_EXPIRY_DAYS})`,
    ));
}

export type SubmitGuardianResult =
  | { kind: "invalid_phone" }
  | { kind: "pending" }
  | { kind: "limit"; scope: string }
  | { kind: "ok"; submissionId: string; remaining: number; matched: { memberId: string; userId: string }[] };

/** ارسالِ درخواستِ اتصال. والد باید قبلاً (توسطِ فراخوان) عضوِ parentِ همین مدرسه بودنش تأیید شده باشد. اعلان را پس از پاسخ با notifyGuardianMatched بفرستید. */
export async function submitGuardianRequest(schoolId: string, parentUserId: string, phoneInput: unknown): Promise<SubmitGuardianResult> {
  const phone = normalizeGuardianPhone(phoneInput);
  if (!phone) return { kind: "invalid_phone" };
  await expireStaleGuardianRequests(schoolId);
  const submissionId = crypto.randomUUID();
  let remaining = 0;
  let matched: { memberId: string; userId: string }[] = [];
  try {
    await db.transaction(async (tx) => {
      // قفلِ مشورتی به‌ازایِ والد تا ۴ درخواستِ هم‌زمان از سقف رد نشوند.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"gr:" + parentUserId}))`);
      const mine = and(eq(schoolGuardianRequestsTable.parentUserId, parentUserId), eq(schoolGuardianRequestsTable.schoolId, schoolId));
      const [{ n: perPhone }] = await tx.select({ n: sql<number>`count(distinct ${schoolGuardianRequestsTable.submissionId})::int` })
        .from(schoolGuardianRequestsTable).where(and(mine, eq(schoolGuardianRequestsTable.normalizedPhone, phone)));
      if (perPhone >= GUARDIAN_PER_PHONE_LIMIT) throw new LimitError("per_phone");
      const [{ n: pending }] = await tx.select({ n: count() }).from(schoolGuardianRequestsTable)
        .where(and(mine, eq(schoolGuardianRequestsTable.normalizedPhone, phone), eq(schoolGuardianRequestsTable.status, "pending")));
      if (pending > 0) throw new LimitError("already_pending");
      const dayAgo = sql`now() - interval '24 hours'`;
      const recent = await tx.selectDistinct({ p: schoolGuardianRequestsTable.normalizedPhone }).from(schoolGuardianRequestsTable)
        .where(and(mine, sql`${schoolGuardianRequestsTable.createdAt} > ${dayAgo}`));
      if (recent.length >= GUARDIAN_DAILY_PHONE_LIMIT && !recent.some((r) => r.p === phone)) throw new LimitError("daily_phones");

      const students = await tx.select({ memberId: schoolMembersTable.id, userId: usersTable.id }).from(usersTable)
        .innerJoin(schoolMembersTable, eq(schoolMembersTable.userId, usersTable.id))
        .where(and(inArray(usersTable.phone, phoneVariants(phone)), eq(schoolMembersTable.schoolId, schoolId), eq(schoolMembersTable.role, "student")));
      const already = students.length
        ? await tx.select({ sid: schoolGuardianshipsTable.studentMemberId }).from(schoolGuardianshipsTable)
            .where(and(eq(schoolGuardianshipsTable.parentUserId, parentUserId), inArray(schoolGuardianshipsTable.studentMemberId, students.map((s) => s.memberId))))
        : [];
      const linked = new Set(already.map((a) => a.sid));
      const now = new Date();
      const rows = (students.length ? students : [null]).map((s) => ({
        id: crypto.randomUUID(), submissionId, schoolId, parentUserId,
        studentMemberId: s?.memberId ?? null, normalizedPhone: phone,
        // قبلاً پیوند دارد: بدونِ اعلانِ بی‌مورد، مستقیم approved (والد خودش همین را می‌داند).
        status: s && linked.has(s.memberId) ? "approved" : "pending",
        decidedAt: s && linked.has(s.memberId) ? now : null,
      }));
      await tx.insert(schoolGuardianRequestsTable).values(rows);
      matched = students.filter((s) => !linked.has(s.memberId));
      remaining = GUARDIAN_PER_PHONE_LIMIT - perPhone - 1;
    });
  } catch (e) {
    if (e instanceof LimitError) return e.code === "already_pending" ? { kind: "pending" } : { kind: "limit", scope: e.code };
    throw e;
  }
  return { kind: "ok", submissionId, remaining: Math.max(0, remaining), matched };
}

/** اعلانِ سایت + (اگر دانش‌آموز به بات وصل است) تلگرام با دکمه‌های تأیید/رد. باید *بعد از* ارسالِ پاسخِ خنثی به والد صدا زده شود. */
export async function notifyGuardianMatched(schoolId: string, parentUserId: string, submissionId: string, matched: { memberId: string; userId: string }[]) {
  if (!matched.length) return;
  const [p] = await db.select({ name: usersTable.name, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, parentUserId)).limit(1);
  const reqRows = await db.select().from(schoolGuardianRequestsTable)
    .where(and(eq(schoolGuardianRequestsTable.submissionId, submissionId), eq(schoolGuardianRequestsTable.status, "pending")));
  const parentLabel = p?.name && !p.email?.endsWith("@parent.telegram.invalid") ? p.name : (p?.name || "یک والد");
  for (const r of reqRows) {
    const s = matched.find((m) => m.memberId === r.studentMemberId);
    if (!s) continue;
    await notifySchoolUsers({
      userIds: [s.userId], schoolId, kind: "school_guardian_request", severity: "info", refId: r.id,
      title: "درخواست اتصال والد",
      body: `${parentLabel} می‌خواهد به‌عنوان والدِ شما ثبت شود. از صفحه‌ی خانه‌ی خود (یا همین‌جا در بات) تأیید یا رد کنید.`,
      telegramButtons: [[{ text: "✅ تأیید", callback_data: `gr:a:${r.id}` }, { text: "❌ رد", callback_data: `gr:r:${r.id}` }]],
    });
  }
}

export type DecideResult =
  | { status: 404 }
  | { status: 409; requestStatus: string }
  | { status: 200; requestStatus: string; idempotent: boolean; parentUserId: string; requestId: string };

/** تأیید/ردِ درخواست توسطِ خودِ دانش‌آموزِ هدف (`student` = ردیفِ عضویتِ اوست؛ فراخوان باید نقش/مدرسه را قبلاً سنجیده باشد). */
export async function decideGuardianRequest(schoolId: string, student: { id: string; userId: string }, requestId: string, decision: "approve" | "reject"): Promise<DecideResult> {
  await expireStaleGuardianRequests(schoolId);
  const target = decision === "approve" ? "approved" : "rejected";
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"grd:" + requestId}))`);
    const [r] = await tx.select().from(schoolGuardianRequestsTable)
      .where(and(eq(schoolGuardianRequestsTable.id, requestId), eq(schoolGuardianRequestsTable.schoolId, schoolId), eq(schoolGuardianRequestsTable.studentMemberId, student.id))).limit(1);
    // برایِ درخواستِ دیگران/ناموجود یک پاسخِ یکسان (۴۰۴) — وجودش لو نرود.
    if (!r) return { status: 404 as const };
    if (r.status === target) return { status: 200 as const, row: r, idempotent: true };
    if (r.status !== "pending") return { status: 409 as const, row: r };
    if (target === "approved") {
      // والد هنوز باید والدِ همین مدرسه باشد.
      const [pm] = await tx.select({ id: schoolMembersTable.id }).from(schoolMembersTable)
        .where(and(eq(schoolMembersTable.userId, r.parentUserId), eq(schoolMembersTable.schoolId, schoolId), eq(schoolMembersTable.role, "parent"))).limit(1);
      if (!pm) return { status: 409 as const, row: r };
      const [exists] = await tx.select({ id: schoolGuardianshipsTable.id }).from(schoolGuardianshipsTable)
        .where(and(eq(schoolGuardianshipsTable.parentUserId, r.parentUserId), eq(schoolGuardianshipsTable.studentMemberId, student.id))).limit(1);
      if (!exists) await tx.insert(schoolGuardianshipsTable).values({ id: crypto.randomUUID(), parentUserId: r.parentUserId, studentMemberId: student.id });
    }
    const [upd] = await tx.update(schoolGuardianRequestsTable).set({ status: target, decidedAt: new Date() })
      .where(and(eq(schoolGuardianRequestsTable.id, r.id), eq(schoolGuardianRequestsTable.status, "pending"))).returning();
    return { status: 200 as const, row: upd, idempotent: false };
  });
  if (result.status === 404) return { status: 404 };
  if (result.status === 409) return { status: 409, requestStatus: result.row.status };
  if (!result.idempotent) {
    const [stu] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, student.userId)).limit(1);
    const kid = stu?.name ? `«${stu.name}»` : "";
    void logSchoolAudit(schoolId, student.userId, target === "approved" ? "guardian.approved" : "guardian.rejected", `request ${result.row.id}`);
    void notifySchoolUsers({
      userIds: [result.row.parentUserId], schoolId, kind: "school_guardian_decision", refId: result.row.id,
      severity: target === "approved" ? "info" : "warning",
      title: target === "approved" ? "درخواست اتصال تأیید شد" : "درخواست اتصال رد شد",
      body: target === "approved" ? `فرزند شما ${kid} متصل شد؛ از این پس در داشبورد (یا منوی بات) شما نمایش داده می‌شود.` : "درخواستِ اتصال انجام نشد. در صورت نیاز از مدیر مدرسه بخواهید شما را ثبت کند.",
      telegramButtons: target === "approved" ? [[{ text: "👪 فرزندان من", callback_data: "p:kids" }]] : undefined,
    }).catch((err) => logger.warn({ err }, "guardian decision notify failed (non-fatal)"));
  }
  return { status: 200, requestStatus: result.row.status, idempotent: result.idempotent, parentUserId: result.row.parentUserId, requestId: result.row.id };
}
