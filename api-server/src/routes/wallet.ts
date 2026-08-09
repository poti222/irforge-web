import { logger } from "../lib/logger";
import { Router } from "express";
import { db, walletsTable, walletTransactionsTable, usersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { createNotification, formatTomanFa } from "../lib/notify";

const router = Router();

function requireSuperAdmin(req: any, res: any, next: any) {
  requireAuth(req, res, async () => {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId)).limit(1);
    if (!user || user.role !== "super_admin") {
      res.status(403).json({ error: "Super admin only" });
      return;
    }
    next();
  });
}

async function ensureWallet(userId: string) {
  const [existing] = await db.select().from(walletsTable).where(eq(walletsTable.userId, userId)).limit(1);
  if (existing) return existing;
  try {
    const [created] = await db.insert(walletsTable)
      .values({ id: crypto.randomUUID(), userId, balance: 0 }).returning();
    return created;
  } catch {
    const [w] = await db.select().from(walletsTable).where(eq(walletsTable.userId, userId)).limit(1);
    return w;
  }
}

function formatTx(t: any) {
  return {
    id: t.id, userId: t.userId, type: t.type, amount: t.amount, status: t.status,
    receiptUrl: t.receiptUrl, txHash: t.txHash, reviewNote: t.reviewNote,
    createdAt: t.createdAt.toISOString(),
  };
}

// GET /api/wallet — balance
router.get("/wallet", requireAuth, async (req: any, res) => {
  try {
    const wallet = await ensureWallet(req.userId);
    res.json({ balance: wallet?.balance ?? 0 });
  } catch (err) {
    logger.error({ err }, "Get wallet error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/wallet/transactions — own transactions
router.get("/wallet/transactions", requireAuth, async (req: any, res) => {
  try {
    const rows = await db.select().from(walletTransactionsTable)
      .where(eq(walletTransactionsTable.userId, req.userId))
      .orderBy(desc(walletTransactionsTable.createdAt));
    res.json(rows.map(formatTx));
  } catch (err) {
    logger.error({ err }, "List wallet tx error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/wallet/deposit — card-to-card or USDT (gateway is disabled/coming soon)
router.post("/wallet/deposit", requireAuth, async (req: any, res) => {
  try {
    const { method, amount, receiptUrl, txHash } = req.body;
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      res.status(400).json({ error: "A positive amount is required" });
      return;
    }
    let type: string;
    if (method === "card") {
      if (!receiptUrl) { res.status(400).json({ error: "Receipt is required for card deposits" }); return; }
      type = "deposit_card";
    } else if (method === "usdt") {
      if (!txHash) { res.status(400).json({ error: "Transaction hash is required for USDT deposits" }); return; }
      type = "deposit_usdt";
    } else {
      res.status(400).json({ error: "Unsupported deposit method" });
      return;
    }
    await ensureWallet(req.userId);
    const [tx] = await db.insert(walletTransactionsTable).values({
      id: crypto.randomUUID(), userId: req.userId, type, amount: Math.round(amt),
      status: "pending", receiptUrl: receiptUrl ?? null, txHash: txHash ?? null,
    }).returning();
    res.status(201).json(formatTx(tx));
  } catch (err) {
    logger.error({ err }, "Wallet deposit error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/wallet/spend — pay from balance (funds already verified, no review)
router.post("/wallet/spend", requireAuth, async (req: any, res) => {
  try {
    const amt = Number(req.body?.amount);
    if (!amt || amt <= 0) { res.status(400).json({ error: "A positive amount is required" }); return; }
    const wallet = await ensureWallet(req.userId);
    if (!wallet || wallet.balance < amt) {
      res.status(400).json({ error: "Insufficient wallet balance", code: "insufficient" });
      return;
    }
    const [updated] = await db.update(walletsTable)
      .set({ balance: wallet.balance - Math.round(amt) })
      .where(eq(walletsTable.userId, req.userId)).returning();
    const [tx] = await db.insert(walletTransactionsTable).values({
      id: crypto.randomUUID(), userId: req.userId, type: "spend", amount: Math.round(amt),
      status: "approved", reviewNote: req.body?.note ?? null,
    }).returning();
    res.json({ balance: updated.balance, transaction: formatTx(tx) });
  } catch (err) {
    logger.error({ err }, "Wallet spend error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── admin review of wallet deposits (super_admin) ───────────────────────────

// GET /api/admin/wallet-deposits — pending deposits + user
router.get("/admin/wallet-deposits", requireSuperAdmin, async (req: any, res) => {
  try {
    const rows = await db.select().from(walletTransactionsTable)
      .where(eq(walletTransactionsTable.status, "pending"))
      .orderBy(desc(walletTransactionsTable.createdAt));
    const enriched = await Promise.all(rows.map(async (t) => {
      const [user] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
        .from(usersTable).where(eq(usersTable.id, t.userId)).limit(1);
      return { ...formatTx(t), user: user ?? null };
    }));
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "List wallet deposits error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/wallet-deposits/:txId/approve — credit the balance
router.post("/admin/wallet-deposits/:txId/approve", requireSuperAdmin, async (req: any, res) => {
  try {
    const [tx] = await db.select().from(walletTransactionsTable)
      .where(eq(walletTransactionsTable.id, req.params.txId)).limit(1);
    if (!tx) { res.status(404).json({ error: "Transaction not found" }); return; }
    if (tx.status !== "pending") { res.status(400).json({ error: "Already reviewed" }); return; }

    await db.update(walletTransactionsTable)
      .set({ status: "approved", reviewedBy: req.userId, reviewNote: req.body?.reviewNote ?? null })
      .where(eq(walletTransactionsTable.id, tx.id));

    const wallet = await ensureWallet(tx.userId);
    const [updated] = await db.update(walletsTable)
      .set({ balance: (wallet?.balance ?? 0) + tx.amount })
      .where(eq(walletsTable.userId, tx.userId)).returning();

    await createNotification({
      userId: tx.userId,
      type: "deposit_approved",
      severity: "info",
      title: "شارژ کیف پول تأیید شد",
      message: `واریز ${formatTomanFa(tx.amount)} تأیید شد و به کیف پول اضافه شد. موجودی فعلی: ${formatTomanFa(updated.balance)}.`
        + (req.body?.reviewNote ? `\n\nیادداشت بررسی‌کننده: ${req.body.reviewNote}` : ""),
    });

    res.json({ success: true, balance: updated.balance });
  } catch (err) {
    logger.error({ err }, "Approve wallet deposit error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/wallet-deposits/:txId/reject
router.post("/admin/wallet-deposits/:txId/reject", requireSuperAdmin, async (req: any, res) => {
  try {
    const [tx] = await db.select().from(walletTransactionsTable)
      .where(and(eq(walletTransactionsTable.id, req.params.txId), eq(walletTransactionsTable.status, "pending")))
      .limit(1);
    if (!tx) { res.status(404).json({ error: "Pending transaction not found" }); return; }
    await db.update(walletTransactionsTable)
      .set({ status: "rejected", reviewedBy: req.userId, reviewNote: req.body?.reviewNote ?? null })
      .where(eq(walletTransactionsTable.id, tx.id));

    await createNotification({
      userId: tx.userId,
      type: "deposit_rejected",
      severity: "warning",
      title: "شارژ کیف پول تأیید نشد",
      message: `واریز ${formatTomanFa(tx.amount)} تأیید نشد و به کیف پول اضافه نشد.`
        + (req.body?.reviewNote ? `\n\nدلیل: ${req.body.reviewNote}` : "")
        + `\n\nاگر فکر می‌کنی اشتباهی رخ داده، فیش را دوباره با کیفیت بهتر ارسال کن یا تیکت بزن.`,
    });

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Reject wallet deposit error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
