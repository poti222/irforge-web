/**
 * routes/schoolGuardianRequests.ts — اتصالِ خودکارِ والد↔دانش‌آموز با شماره‌یِ دانش‌آموز (به‌جایِ فقط مدیر).
 * ─────────────────────────────────────────────────────────────────────────
 * قواعد (مستند برایِ کاربر):
 *  • سقفِ هر والد: حداکثر ۳ ارسال برایِ «هر شماره» (همه‌یِ ارسال‌ها، حتی شماره‌یِ بی‌صاحب/ردشده/لغوشده می‌شمارند)،
 *    و حداکثر ۱۰ شماره‌یِ متفاوت در هر ۲۴ ساعت (ضدِ شمارش‌گریِ شماره‌ها). پس از سقف: کدِ `guardian_request_limit`
 *    → UI می‌گوید «به مدیر مدرسه بگویید تا شما را به‌عنوان والد ثبت کند» (مسیرِ دستیِ مدیر همچنان هست).
 *  • حریم: پاسخِ ارسال برایِ شماره‌یِ پیداشده و پیدانشده کاملاً هم‌شکل است؛ فقط پیداشده اعلان می‌گیرد (پس از ارسالِ پاسخ).
 *    فقط دانش‌آموزانِ *همین مدرسه* تطبیق می‌خورند. دانش‌آموز فقط «نامِ» والد را می‌بیند.
 *  • درخواست ۷ روز اعتبار دارد (lazy)؛ تأیید پیوندِ school_guardianships می‌سازد (idempotent).
 */
import { Router } from "express";
import crypto from "crypto";
import { and, eq, inArray, sql, count } from "drizzle-orm";
import {
  db, schoolGuardianRequestsTable, schoolGuardianshipsTable, schoolMembersTable, usersTable,
} from "@workspace/db";
import { requireAuth } from "./auth";
import { getSchoolMember } from "../lib/schoolAuth";
import { normalizeGuardianPhone, maskPhone, phoneVariants } from "../lib/guardianPhone";
import { notifySchoolUsers } from "../lib/schoolNotify";
import { logSchoolAudit } from "../lib/schoolAuditLog";
import { logger } from "../lib/logger";

const router = Router();

export const GUARDIAN_PER_PHONE_LIMIT = 3;
export const GUARDIAN_DAILY_PHONE_LIMIT = 10;
const EXPIRY_DAYS = 7;
const NEUTRAL_MESSAGE = "اگر این شماره متعلق به یک دانش‌آموز این مدرسه باشد، درخواست برای او ارسال شد";

class LimitError extends Error { constructor(public code: string) { super(code); } }

async function ownMember(userId: string, schoolId: string, role: "student" | "parent") {
  const m = await getSchoolMember(userId);
  return m && m.schoolId === schoolId && m.role === role ? m : null;
}

/** pending هایِ قدیمی‌تر از ۷ روز → expired (قبل از هر خواندن/تصمیم). */
async function expireStale(schoolId: string) {
  await db.update(schoolGuardianRequestsTable)
    .set({ status: "expired", decidedAt: new Date() })
    .where(and(
      eq(schoolGuardianRequestsTable.schoolId, schoolId),
      eq(schoolGuardianRequestsTable.status, "pending"),
      sql`${schoolGuardianRequestsTable.createdAt} < now() - make_interval(days => ${EXPIRY_DAYS})`,
    ));
}

// POST /api/schools/:schoolId/guardian-requests { phone }
router.post("/schools/:schoolId/guardian-requests", requireAuth, async (req: any, res) => {
  try {
    const { schoolId } = req.params;
    const parent = await ownMember(req.userId, schoolId, "parent");
    if (!parent) { res.status(403).json({ error: "Forbidden" }); return; }
    const phone = normalizeGuardianPhone(req.body?.phone);
    if (!phone) { res.status(400).json({ error: "Invalid phone", code: "invalid_phone" }); return; }
    await expireStale(schoolId);

    const submissionId = crypto.randomUUID();
    let remaining = 0;
    let matched: { memberId: string; userId: string }[] = [];
    try {
      await db.transaction(async (tx) => {
        // قفلِ مشورتی به‌ازایِ والد تا ۴ درخواستِ هم‌زمان از سقف رد نشوند.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"gr:" + req.userId}))`);
        const mine = and(eq(schoolGuardianRequestsTable.parentUserId, req.userId), eq(schoolGuardianRequestsTable.schoolId, schoolId));
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
        matched = students;
        const already = students.length
          ? await tx.select({ sid: schoolGuardianshipsTable.studentMemberId }).from(schoolGuardianshipsTable)
              .where(and(eq(schoolGuardianshipsTable.parentUserId, req.userId), inArray(schoolGuardianshipsTable.studentMemberId, students.map((s) => s.memberId))))
          : [];
        const linked = new Set(already.map((a) => a.sid));
        const now = new Date();
        const rows = (students.length ? students : [null]).map((s) => ({
          id: crypto.randomUUID(), submissionId, schoolId, parentUserId: req.userId,
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
      if (e instanceof LimitError) {
        if (e.code === "already_pending") {
          res.status(409).json({ error: "A request for this number is already pending", code: "guardian_request_pending" });
        } else {
          res.status(429).json({ error: "Request limit reached", code: "guardian_request_limit", scope: e.code, contactAdmin: true });
        }
        return;
      }
      throw e;
    }

    // پاسخِ هم‌شکل برایِ پیداشده/پیدانشده.
    res.status(201).json({ ok: true, message: NEUTRAL_MESSAGE, requestId: submissionId, status: "pending", remainingForPhone: Math.max(0, remaining) });

    // اعلان پس از ارسالِ پاسخ تا زمانِ پاسخ بینِ دو حالت تفاوتی نداشته باشد.
    if (matched.length) {
      void (async () => {
        const [p] = await db.select({ name: usersTable.name, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, req.userId)).limit(1);
        const reqRows = await db.select().from(schoolGuardianRequestsTable)
          .where(and(eq(schoolGuardianRequestsTable.submissionId, submissionId), eq(schoolGuardianRequestsTable.status, "pending")));
        for (const r of reqRows) {
          const s = matched.find((m) => m.memberId === r.studentMemberId);
          if (!s) continue;
          await notifySchoolUsers({
            userIds: [s.userId], schoolId, kind: "school_guardian_request", severity: "info", refId: r.id,
            title: "درخواست اتصال والد",
            body: `${p?.name || p?.email || "یک والد"} می‌خواهد به‌عنوان والدِ شما ثبت شود. از صفحه‌ی خانه‌ی خود تأیید یا رد کنید.`,
          });
        }
      })().catch((err) => logger.warn({ err }, "guardian request notify failed (non-fatal)"));
    }
  } catch (err) {
    logger.error({ err }, "Create guardian request error");
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/guardian-requests/mine — وضعیتِ درخواست‌هایِ خودِ والد + سهمیه.
router.get("/schools/:schoolId/guardian-requests/mine", requireAuth, async (req: any, res) => {
  try {
    const { schoolId } = req.params;
    if (!(await ownMember(req.userId, schoolId, "parent"))) { res.status(403).json({ error: "Forbidden" }); return; }
    await expireStale(schoolId);
    const rows = await db.select().from(schoolGuardianRequestsTable)
      .where(and(eq(schoolGuardianRequestsTable.parentUserId, req.userId), eq(schoolGuardianRequestsTable.schoolId, schoolId)));
    rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    // چند ردیفِ یک ارسال (هم‌شماره‌ها) برایِ والد یک مورد است؛ وضعیت = «بهترین» آن‌ها.
    const rank: Record<string, number> = { approved: 5, pending: 4, rejected: 3, cancelled: 2, expired: 1 };
    const bySub = new Map<string, typeof rows>();
    for (const r of rows) bySub.set(r.submissionId, [...(bySub.get(r.submissionId) ?? []), r]);
    const requests = [...bySub.entries()].map(([sid, rs]) => {
      const best = rs.reduce((a, b) => (rank[b.status] > rank[a.status] ? b : a));
      return { id: sid, phone: maskPhone(best.normalizedPhone), status: best.status, createdAt: rs[0].createdAt.toISOString(), decidedAt: best.decidedAt ? best.decidedAt.toISOString() : null };
    });
    const perPhone = new Map<string, Set<string>>();
    for (const r of rows) perPhone.set(r.normalizedPhone, (perPhone.get(r.normalizedPhone) ?? new Set()).add(r.submissionId));
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const phonesToday = new Set(rows.filter((r) => r.createdAt.getTime() > dayAgo).map((r) => r.normalizedPhone));
    res.json({
      requests,
      limits: {
        perPhone: GUARDIAN_PER_PHONE_LIMIT,
        dailyPhones: GUARDIAN_DAILY_PHONE_LIMIT,
        dailyPhonesUsed: phonesToday.size,
        usedByPhone: [...perPhone.entries()].map(([p, s]) => ({ phone: maskPhone(p), used: s.size, remaining: Math.max(0, GUARDIAN_PER_PHONE_LIMIT - s.size) })),
      },
    });
  } catch (err) {
    logger.error({ err }, "List my guardian requests error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/guardian-requests/:submissionId/cancel — والد درخواستِ pendingِ خودش را لغو می‌کند (از سهمیه کم نمی‌شود/پس نمی‌گیرد).
router.post("/schools/:schoolId/guardian-requests/:id/cancel", requireAuth, async (req: any, res) => {
  try {
    const { schoolId } = req.params;
    if (!(await ownMember(req.userId, schoolId, "parent"))) { res.status(403).json({ error: "Forbidden" }); return; }
    const rows = await db.update(schoolGuardianRequestsTable).set({ status: "cancelled", decidedAt: new Date() })
      .where(and(eq(schoolGuardianRequestsTable.submissionId, req.params.id), eq(schoolGuardianRequestsTable.parentUserId, req.userId),
        eq(schoolGuardianRequestsTable.schoolId, schoolId), eq(schoolGuardianRequestsTable.status, "pending"))).returning({ id: schoolGuardianRequestsTable.id });
    if (!rows.length) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Cancel guardian request error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/guardian-requests/incoming — درخواست‌هایِ pendingِ خودِ دانش‌آموز (فقط نامِ والد).
router.get("/schools/:schoolId/guardian-requests/incoming", requireAuth, async (req: any, res) => {
  try {
    const { schoolId } = req.params;
    const student = await ownMember(req.userId, schoolId, "student");
    if (!student) { res.status(403).json({ error: "Forbidden" }); return; }
    await expireStale(schoolId);
    const rows = await db.select({ r: schoolGuardianRequestsTable, name: usersTable.name }).from(schoolGuardianRequestsTable)
      .innerJoin(usersTable, eq(usersTable.id, schoolGuardianRequestsTable.parentUserId))
      .where(and(eq(schoolGuardianRequestsTable.studentMemberId, student.id), eq(schoolGuardianRequestsTable.schoolId, schoolId), eq(schoolGuardianRequestsTable.status, "pending")));
    res.json(rows.map(({ r, name }) => ({ id: r.id, parentName: name, createdAt: r.createdAt.toISOString() })));
  } catch (err) {
    logger.error({ err }, "List incoming guardian requests error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/guardian-requests/:id/decision { decision: "approve" | "reject" } — فقط خودِ دانش‌آموزِ هدف.
router.post("/schools/:schoolId/guardian-requests/:id/decision", requireAuth, async (req: any, res) => {
  try {
    const { schoolId } = req.params;
    const student = await ownMember(req.userId, schoolId, "student");
    const decision = req.body?.decision;
    if (decision !== "approve" && decision !== "reject") { res.status(400).json({ error: "decision must be approve or reject" }); return; }
    if (!student) { res.status(403).json({ error: "Forbidden" }); return; }
    await expireStale(schoolId);
    const target = decision === "approve" ? "approved" : "rejected";
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"grd:" + req.params.id}))`);
      const [r] = await tx.select().from(schoolGuardianRequestsTable)
        .where(and(eq(schoolGuardianRequestsTable.id, req.params.id), eq(schoolGuardianRequestsTable.schoolId, schoolId), eq(schoolGuardianRequestsTable.studentMemberId, student.id))).limit(1);
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
    if (result.status === 404) { res.status(404).json({ error: "Not found" }); return; }
    if (result.status === 409) { res.status(409).json({ error: "Request already decided", code: "already_decided", status: result.row.status }); return; }
    if (!result.idempotent) {
      void logSchoolAudit(schoolId, req.userId, target === "approved" ? "guardian.approved" : "guardian.rejected", `request ${result.row.id}`);
      void notifySchoolUsers({
        userIds: [result.row.parentUserId], schoolId, kind: "school_guardian_decision", refId: result.row.id,
        severity: target === "approved" ? "info" : "warning",
        title: target === "approved" ? "درخواست اتصال تأیید شد" : "درخواست اتصال رد شد",
        body: target === "approved" ? "دانش‌آموز درخواست شما را تأیید کرد؛ فرزند در داشبورد شما نمایش داده می‌شود." : "دانش‌آموز درخواست شما را رد کرد. در صورت نیاز از مدیر مدرسه بخواهید شما را ثبت کند.",
      });
    }
    res.json({ ok: true, status: result.row.status, idempotent: result.idempotent });
  } catch (err) {
    logger.error({ err }, "Decide guardian request error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
