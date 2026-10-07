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
import {
  GUARDIAN_PER_PHONE_LIMIT, GUARDIAN_DAILY_PHONE_LIMIT, GUARDIAN_NEUTRAL_MESSAGE, expireStaleGuardianRequests,
  submitGuardianRequest, notifyGuardianMatched, decideGuardianRequest,
} from "../lib/schoolGuardianCore";
import { logger } from "../lib/logger";

const router = Router();

export { GUARDIAN_PER_PHONE_LIMIT, GUARDIAN_DAILY_PHONE_LIMIT };
const NEUTRAL_MESSAGE = GUARDIAN_NEUTRAL_MESSAGE;

async function ownMember(userId: string, schoolId: string, role: "student" | "parent") {
  const m = await getSchoolMember(userId);
  return m && m.schoolId === schoolId && m.role === role ? m : null;
}

const expireStale = expireStaleGuardianRequests;

// POST /api/schools/:schoolId/guardian-requests { phone } — منطق در lib/schoolGuardianCore.ts (مشترک با باتِ تلگرام).
router.post("/schools/:schoolId/guardian-requests", requireAuth, async (req: any, res) => {
  try {
    const { schoolId } = req.params;
    const parent = await ownMember(req.userId, schoolId, "parent");
    if (!parent) { res.status(403).json({ error: "Forbidden" }); return; }
    const r = await submitGuardianRequest(schoolId, req.userId, req.body?.phone);
    if (r.kind === "invalid_phone") { res.status(400).json({ error: "Invalid phone", code: "invalid_phone" }); return; }
    if (r.kind === "pending") { res.status(409).json({ error: "A request for this number is already pending", code: "guardian_request_pending" }); return; }
    if (r.kind === "limit") { res.status(429).json({ error: "Request limit reached", code: "guardian_request_limit", scope: r.scope, contactAdmin: true }); return; }
    // پاسخِ هم‌شکل برایِ پیداشده/پیدانشده.
    res.status(201).json({ ok: true, message: NEUTRAL_MESSAGE, requestId: r.submissionId, status: "pending", remainingForPhone: r.remaining });
    // اعلان پس از ارسالِ پاسخ تا زمانِ پاسخ بینِ دو حالت تفاوتی نداشته باشد.
    void notifyGuardianMatched(schoolId, req.userId, r.submissionId, r.matched).catch((err) => logger.warn({ err }, "guardian request notify failed (non-fatal)"));
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
    const r = await decideGuardianRequest(schoolId, { id: student.id, userId: req.userId }, req.params.id, decision);
    if (r.status === 404) { res.status(404).json({ error: "Not found" }); return; }
    if (r.status === 409) { res.status(409).json({ error: "Request already decided", code: "already_decided", status: r.requestStatus }); return; }
    res.json({ ok: true, status: r.requestStatus, idempotent: r.idempotent });
  } catch (err) {
    logger.error({ err }, "Decide guardian request error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
