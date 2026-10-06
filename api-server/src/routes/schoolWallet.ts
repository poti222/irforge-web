/**
 * routes/schoolWallet.ts — کیف‌پولِ مدرسه (جدا از کیف‌پولِ شخصی/باتِ پلتفرم).
 * ─────────────────────────────────────────────────────────────────────────
 * مدیرِ مدرسه: موجودی + تاریخچه + «درخواستِ شارژ» (مبلغ + توضیح).
 * سوپرادمین (/super، با requireSuperGate): شارژ/کسرِ دستی با دلیلِ ثبت‌شده و تأیید/ردِ درخواست‌هایِ شارژ.
 *
 * چرا موتورِ کارت‌به‌کارتِ خودکار (payment_requests) گسترش نیافت: آن جدول CHECKهایِ سخت روی scope∈{platform,bot} و
 * purpose∈{wallet_topup,order} دارد، رجیستریِ effectها fail-closed و مشترک با APIِ بات‌هاست، و تطبیقِ پیامک/پنلِ ادمین/
 * اعلان‌ها همه روی همان دو مقدار نوشته شده‌اند؛ افزودنِ scope سومِ «school» یعنی دست‌زدن به مسیرِ پولیِ شخصیِ در حالِ
 * کار. به‌جایش مسیرِ جدا و ساده: شارژ/کسرِ دستیِ سوپرادمین + درخواستِ شارژ — هر دو تراکنشی و در ledgerِ همین کیف‌پول.
 */
import { Router } from "express";
import crypto from "crypto";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import {
  db, schoolsTable, schoolWalletTransactionsTable, schoolWalletTopupRequestsTable, usersTable,
} from "@workspace/db";
import { requireAuth, requireSuperAdmin } from "./auth";
import { requireSuperGate } from "../middleware/superGate";
import { canAccessSchool, SCHOOL_ADMIN_ONLY } from "../lib/schoolAuth";
import {
  creditSchoolWallet, debitSchoolWallet, getSchoolWalletBalance, SchoolWalletInsufficientError,
  SCHOOL_WALLET_MAX_AMOUNT_RIAL,
} from "../lib/schoolWallet";
import { logSchoolAudit } from "../lib/schoolAuditLog";
import { notifySchoolUsers } from "../lib/schoolNotify";
import { logger } from "../lib/logger";

const router = Router();
const superGuard = [requireSuperAdmin, requireSuperGate] as const;

const MIN_REQUEST_RIAL = 100_000; // ۱۰ هزار تومان
const MAX_PENDING_REQUESTS = 3;

const fmtTxn = (t: typeof schoolWalletTransactionsTable.$inferSelect) => ({
  id: t.id, type: t.type, amountRial: t.amount, balanceAfterRial: t.balanceAfter, description: t.description,
  refId: t.refId, createdByUserId: t.createdByUserId, createdAt: t.createdAt.toISOString(),
});
const fmtReq = (r: typeof schoolWalletTopupRequestsTable.$inferSelect) => ({
  id: r.id, schoolId: r.schoolId, amountRial: r.amountRial, note: r.note, status: r.status,
  decisionNote: r.decisionNote, createdAt: r.createdAt.toISOString(), decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
});

const parseAmount = (v: unknown): number | null => {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= SCHOOL_WALLET_MAX_AMOUNT_RIAL ? n : null;
};
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function adminGuard(req: any, res: any): Promise<boolean> {
  const { ok } = await canAccessSchool(req.userId, req.params.schoolId, SCHOOL_ADMIN_ONLY);
  if (!ok) { res.status(403).json({ error: "Forbidden" }); return false; }
  return true;
}

async function walletSummary(schoolId: string, limit = 20) {
  const [balanceRial, txns, pending] = await Promise.all([
    getSchoolWalletBalance(schoolId),
    db.select().from(schoolWalletTransactionsTable).where(eq(schoolWalletTransactionsTable.schoolId, schoolId))
      .orderBy(desc(schoolWalletTransactionsTable.createdAt), desc(schoolWalletTransactionsTable.id)).limit(limit + 1),
    db.select().from(schoolWalletTopupRequestsTable)
      .where(and(eq(schoolWalletTopupRequestsTable.schoolId, schoolId), eq(schoolWalletTopupRequestsTable.status, "pending")))
      .orderBy(desc(schoolWalletTopupRequestsTable.createdAt)),
  ]);
  return {
    balanceRial,
    transactions: txns.slice(0, limit).map(fmtTxn),
    hasMore: txns.length > limit,
    pendingRequests: pending.map(fmtReq),
  };
}

// GET /api/schools/:schoolId/wallet — فقط مدیرِ همان مدرسه.
router.get("/schools/:schoolId/wallet", requireAuth, async (req: any, res) => {
  try {
    if (!(await adminGuard(req, res))) return;
    res.json(await walletSummary(req.params.schoolId));
  } catch (err) {
    logger.error({ err }, "Get school wallet error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/wallet/transactions?before=<ISO>&limit= — صفحه‌بندیِ ساده با مکان‌نمای زمان.
router.get("/schools/:schoolId/wallet/transactions", requireAuth, async (req: any, res) => {
  try {
    if (!(await adminGuard(req, res))) return;
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const before = typeof req.query.before === "string" ? new Date(req.query.before) : null;
    const rows = await db.select().from(schoolWalletTransactionsTable)
      .where(and(eq(schoolWalletTransactionsTable.schoolId, req.params.schoolId), before && !isNaN(+before) ? lt(schoolWalletTransactionsTable.createdAt, before) : undefined))
      .orderBy(desc(schoolWalletTransactionsTable.createdAt), desc(schoolWalletTransactionsTable.id)).limit(limit + 1);
    res.json({ transactions: rows.slice(0, limit).map(fmtTxn), hasMore: rows.length > limit });
  } catch (err) {
    logger.error({ err }, "List school wallet transactions error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/schools/:schoolId/wallet/topup-requests { amountRial, note }
router.post("/schools/:schoolId/wallet/topup-requests", requireAuth, async (req: any, res) => {
  try {
    if (!(await adminGuard(req, res))) return;
    const amountRial = parseAmount(req.body?.amountRial);
    if (!amountRial || amountRial < MIN_REQUEST_RIAL) { res.status(400).json({ error: "Invalid amount", code: "invalid_amount", minRial: MIN_REQUEST_RIAL }); return; }
    const schoolId = req.params.schoolId;
    const row = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"swr:" + schoolId}))`);
      const pend = await tx.select({ id: schoolWalletTopupRequestsTable.id }).from(schoolWalletTopupRequestsTable)
        .where(and(eq(schoolWalletTopupRequestsTable.schoolId, schoolId), eq(schoolWalletTopupRequestsTable.status, "pending")));
      if (pend.length >= MAX_PENDING_REQUESTS) return null;
      const [r] = await tx.insert(schoolWalletTopupRequestsTable).values({
        id: crypto.randomUUID(), schoolId, requestedByUserId: req.userId, amountRial, note: text(req.body?.note, 500) || null,
      }).returning();
      return r;
    });
    if (!row) { res.status(429).json({ error: "Too many pending requests", code: "too_many_pending" }); return; }
    void logSchoolAudit(schoolId, req.userId, "wallet.topup_requested", `${amountRial} rial (request ${row.id})`);
    res.status(201).json(fmtReq(row));
  } catch (err) {
    logger.error({ err }, "Create school wallet topup request error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/schools/:schoolId/wallet/topup-requests — درخواست‌هایِ خودِ مدرسه (آخرین ۲۰).
router.get("/schools/:schoolId/wallet/topup-requests", requireAuth, async (req: any, res) => {
  try {
    if (!(await adminGuard(req, res))) return;
    const rows = await db.select().from(schoolWalletTopupRequestsTable).where(eq(schoolWalletTopupRequestsTable.schoolId, req.params.schoolId))
      .orderBy(desc(schoolWalletTopupRequestsTable.createdAt)).limit(20);
    res.json(rows.map(fmtReq));
  } catch (err) {
    logger.error({ err }, "List school wallet topup requests error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/schools/:schoolId/wallet/topup-requests/:id/cancel", requireAuth, async (req: any, res) => {
  try {
    if (!(await adminGuard(req, res))) return;
    const rows = await db.update(schoolWalletTopupRequestsTable).set({ status: "cancelled", decidedAt: new Date(), decidedByUserId: req.userId })
      .where(and(eq(schoolWalletTopupRequestsTable.id, req.params.id), eq(schoolWalletTopupRequestsTable.schoolId, req.params.schoolId), eq(schoolWalletTopupRequestsTable.status, "pending"))).returning();
    if (!rows.length) { res.status(404).json({ error: "Not found" }); return; }
    res.json(fmtReq(rows[0]));
  } catch (err) {
    logger.error({ err }, "Cancel school wallet topup request error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── سوپرادمین ─────────────────────────────────────────────────────────────

// GET /api/super/schools/:schoolId/wallet
router.get("/super/schools/:schoolId/wallet", ...superGuard, async (req: any, res) => {
  try {
    const [s] = await db.select({ id: schoolsTable.id, name: schoolsTable.name }).from(schoolsTable).where(eq(schoolsTable.id, req.params.schoolId)).limit(1);
    if (!s) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ school: s, ...(await walletSummary(s.id)) });
  } catch (err) {
    logger.error({ err }, "Super get school wallet error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/super/schools/:schoolId/wallet/adjust { direction: "credit"|"debit", amountRial, reason }
router.post("/super/schools/:schoolId/wallet/adjust", ...superGuard, async (req: any, res) => {
  try {
    const direction = req.body?.direction;
    const reason = text(req.body?.reason, 300);
    const amountRial = parseAmount(req.body?.amountRial);
    if (direction !== "credit" && direction !== "debit") { res.status(400).json({ error: "direction must be credit or debit" }); return; }
    if (!amountRial) { res.status(400).json({ error: "Invalid amount", code: "invalid_amount" }); return; }
    if (reason.length < 3) { res.status(400).json({ error: "reason is required", code: "reason_required" }); return; }
    const [school] = await db.select({ id: schoolsTable.id, name: schoolsTable.name }).from(schoolsTable).where(eq(schoolsTable.id, req.params.schoolId)).limit(1);
    if (!school) { res.status(404).json({ error: "Not found" }); return; }
    let result: { balance: number; txnId: string };
    try {
      result = await db.transaction(async (tx) => {
        const move = { schoolId: school.id, amountRial, description: reason, createdByUserId: req.userId };
        if (direction === "credit") return creditSchoolWallet({ ...move, type: "admin_credit" }, tx);
        const r = await debitSchoolWallet({ ...move, type: "admin_debit" }, tx);
        if (!r) throw new SchoolWalletInsufficientError(); // throw → rollback (return معمولی commit می‌کرد)
        return r;
      });
    } catch (e) {
      if (e instanceof SchoolWalletInsufficientError) { res.status(409).json({ error: "Insufficient school wallet balance", code: "insufficient" }); return; }
      throw e;
    }
    void logSchoolAudit(school.id, req.userId, direction === "credit" ? "wallet.admin_credit" : "wallet.admin_debit", `${amountRial} rial: ${reason}`);
    res.json({ ok: true, balanceRial: result.balance, txnId: result.txnId });
  } catch (err) {
    logger.error({ err }, "Super school wallet adjust error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/super/school-wallet-requests?status=pending
router.get("/super/school-wallet-requests", ...superGuard, async (req: any, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : "pending";
    const rows = await db.select({ r: schoolWalletTopupRequestsTable, schoolName: schoolsTable.name, userName: usersTable.name }).from(schoolWalletTopupRequestsTable)
      .innerJoin(schoolsTable, eq(schoolsTable.id, schoolWalletTopupRequestsTable.schoolId))
      .leftJoin(usersTable, eq(usersTable.id, schoolWalletTopupRequestsTable.requestedByUserId))
      .where(eq(schoolWalletTopupRequestsTable.status, status))
      .orderBy(desc(schoolWalletTopupRequestsTable.createdAt)).limit(100);
    res.json(rows.map(({ r, schoolName, userName }) => ({ ...fmtReq(r), schoolName, requestedByName: userName })));
  } catch (err) {
    logger.error({ err }, "Super list school wallet requests error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/super/school-wallet-requests/:id/decision { decision: "approve"|"reject", note?, amountRial? }
router.post("/super/school-wallet-requests/:id/decision", ...superGuard, async (req: any, res) => {
  try {
    const decision = req.body?.decision;
    if (decision !== "approve" && decision !== "reject") { res.status(400).json({ error: "decision must be approve or reject" }); return; }
    const note = text(req.body?.note, 300) || null;
    const out = await db.transaction(async (tx) => {
      // رقابتِ دو تأییدِ هم‌زمان: UPDATEِ شرطی فقط برایِ یکی ردیف برمی‌گرداند؛ دیگری ۴۰۹.
      const [r] = await tx.update(schoolWalletTopupRequestsTable)
        .set({ status: decision === "approve" ? "approved" : "rejected", decidedByUserId: req.userId, decisionNote: note, decidedAt: new Date() })
        .where(and(eq(schoolWalletTopupRequestsTable.id, req.params.id), eq(schoolWalletTopupRequestsTable.status, "pending"))).returning();
      if (!r) return null;
      let balance: number | null = null;
      if (decision === "approve") {
        const c = await creditSchoolWallet({
          schoolId: r.schoolId, amountRial: r.amountRial, type: "credit", refId: r.id, createdByUserId: req.userId,
          description: `شارژ بر اساس درخواستِ مدرسه${note ? ` — ${note}` : ""}`,
        }, tx);
        await tx.update(schoolWalletTopupRequestsTable).set({ txnId: c.txnId }).where(eq(schoolWalletTopupRequestsTable.id, r.id));
        balance = c.balance;
      }
      return { r, balance };
    });
    if (!out) { res.status(409).json({ error: "Request is not pending", code: "not_pending" }); return; }
    void logSchoolAudit(out.r.schoolId, req.userId, decision === "approve" ? "wallet.topup_approved" : "wallet.topup_rejected", `${out.r.amountRial} rial (request ${out.r.id})`);
    void notifySchoolUsers({
      userIds: [out.r.requestedByUserId], schoolId: out.r.schoolId, kind: "school_wallet_topup_decision", refId: out.r.id,
      severity: decision === "approve" ? "info" : "warning",
      title: decision === "approve" ? "کیف پول مدرسه شارژ شد" : "درخواست شارژ کیف پول مدرسه رد شد",
      body: decision === "approve" ? "درخواست شارژ شما تأیید و به کیف پول مدرسه افزوده شد." : `درخواست شارژ شما رد شد.${note ? ` دلیل: ${note}` : ""}`,
    });
    res.json({ ok: true, status: decision === "approve" ? "approved" : "rejected", balanceRial: out.balance });
  } catch (err) {
    logger.error({ err }, "Super decide school wallet request error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
