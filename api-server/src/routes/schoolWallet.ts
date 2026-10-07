/**
 * routes/schoolWallet.ts — کیف‌پولِ مدرسه (جدا از کیف‌پولِ شخصی/باتِ پلتفرم): موجودی + تاریخچه برایِ مدیرِ مدرسه،
 * و شارژ/کسرِ دستیِ سوپرادمین (/super، با دلیلِ ثبت‌شده) به‌عنوانِ ابزارِ کمکی.
 * شارژِ واقعیِ مدیر از همان جریانِ کارت‌به‌کارتِ خودکارِ کیف‌پولِ شخصی است: routes/schoolWalletTopup.ts
 * (جدولِ قدیمیِ school_wallet_topup_requests فقط برایِ تاریخچه مانده و هیچ‌جا نمایش/نوشته نمی‌شود).
 */
import { Router } from "express";
import { and, desc, eq, lt } from "drizzle-orm";
import {
  db, schoolsTable, schoolWalletTransactionsTable,
} from "@workspace/db";
import { requireAuth, requireSuperAdmin } from "./auth";
import { requireSuperGate } from "../middleware/superGate";
import { canAccessSchool, SCHOOL_ADMIN_ONLY } from "../lib/schoolAuth";
import {
  creditSchoolWallet, debitSchoolWallet, getSchoolWalletBalance, SchoolWalletInsufficientError,
  SCHOOL_WALLET_MAX_AMOUNT_RIAL,
} from "../lib/schoolWallet";
import { logSchoolAudit } from "../lib/schoolAuditLog";
import { logger } from "../lib/logger";

const router = Router();
const superGuard = [requireSuperAdmin, requireSuperGate] as const;


const fmtTxn = (t: typeof schoolWalletTransactionsTable.$inferSelect) => ({
  id: t.id, type: t.type, amountRial: t.amount, balanceAfterRial: t.balanceAfter, description: t.description,
  refId: t.refId, createdByUserId: t.createdByUserId, createdAt: t.createdAt.toISOString(),
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
  const [balanceRial, txns] = await Promise.all([
    getSchoolWalletBalance(schoolId),
    db.select().from(schoolWalletTransactionsTable).where(eq(schoolWalletTransactionsTable.schoolId, schoolId))
      .orderBy(desc(schoolWalletTransactionsTable.createdAt), desc(schoolWalletTransactionsTable.id)).limit(limit + 1),
  ]);
  return {
    balanceRial,
    transactions: txns.slice(0, limit).map(fmtTxn),
    hasMore: txns.length > limit,
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

export default router;
