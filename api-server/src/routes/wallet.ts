import { logger } from "../lib/logger";
import { requireCompleteProfile } from "../lib/profile";
import { blockWhileImpersonating } from "../middleware/impersonation";
import { Router } from "express";
import { db, walletsTable, walletTransactionsTable, usersTable } from "@workspace/db";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { createNotification, notifySuperAdmins, formatTomanFa } from "../lib/notify";
import { getPaymentMethods, setPaymentMethods } from "../lib/platformSettings";
import { ensureWallet } from "../lib/wallet.js";

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

/**
 * GET /api/wallet/deposit-info — «پول را کجا بفرستم؟»
 *
 * تا پیش از این، تب تتر در صفحه‌ی کیف پول فقط «هش تراکنش» می‌خواست و هیچ‌جا
 * آدرس مقصد را نشان نمی‌داد؛ یعنی کاربر عملاً نمی‌توانست واریز کند. این
 * endpoint همان اطلاعات را از `platform_settings` می‌دهد (ببینید
 * lib/platformSettings.ts). فقط برای کاربر لاگین‌شده، چون شماره کارت مقصد
 * چیزی نیست که روی اینترنتِ باز بگذاریم.
 */
router.get("/wallet/deposit-info", requireAuth, async (_req: any, res) => {
  try {
    res.json(await getPaymentMethods());
  } catch (err) {
    logger.error({ err }, "Get deposit info error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/payment-settings — همان مقادیر، برای ویرایش در پنل ادمین.
router.get("/admin/payment-settings", requireSuperAdmin, async (_req: any, res) => {
  try {
    res.json(await getPaymentMethods());
  } catch (err) {
    logger.error({ err }, "Get payment settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/admin/payment-settings — ذخیره‌ی آدرس تتر / شماره کارت.
router.put("/admin/payment-settings", requireSuperAdmin, blockWhileImpersonating, async (req: any, res) => {
  try {
    const saved = await setPaymentMethods(req.body, req.userId);
    logger.info({ userId: req.userId }, "payment settings updated");
    res.json(saved);
  } catch (err) {
    logger.error({ err }, "Update payment settings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/wallet/deposit — card-to-card or USDT (gateway is disabled/coming soon)
router.post("/wallet/deposit", requireAuth, blockWhileImpersonating, requireCompleteProfile(), async (req: any, res) => {
  try {
    const { method, amount, receiptUrl, txHash } = req.body;
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      res.status(400).json({ error: "A positive amount is required" });
      return;
    }
    // روشی که سوپرادمین خاموشش کرده نباید از راه API باز بماند — فرانت تبش
    // را پنهان می‌کند، ولی تصمیم واقعی باید سمت سرور گرفته شود.
    const methods = await getPaymentMethods();
    let type: string;
    if (method === "card") {
      if (!methods.card.enabled) { res.status(400).json({ error: "Card deposits are currently disabled" }); return; }
      if (!receiptUrl) { res.status(400).json({ error: "Receipt is required for card deposits" }); return; }
      type = "deposit_card";
    } else if (method === "usdt") {
      if (!methods.usdt.enabled) { res.status(400).json({ error: "USDT deposits are currently disabled" }); return; }
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

    // تا امروز فقط با باز کردنِ خودِ صفحه‌ی «واریزها» فهمیده می‌شد — نه تلگرام،
    // نه زنگوله‌ی سایت.
    await notifySuperAdmins({
      type: "admin_deposit_pending",
      severity: "info",
      title: "واریز کیف پول در انتظار بررسی",
      message: `یک واریز ${method === "card" ? "کارت‌به‌کارت" : "تتری"} به مبلغ ${formatTomanFa(Math.round(amt))} در انتظار تأیید است.`,
      refId: tx.id,
    });

    res.status(201).json(formatTx(tx));
  } catch (err) {
    logger.error({ err }, "Wallet deposit error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/wallet/spend — pay from balance (funds already verified, no review)
router.post("/wallet/spend", requireAuth, blockWhileImpersonating, async (req: any, res) => {
  try {
    const amt = Number(req.body?.amount);
    if (!amt || amt <= 0) { res.status(400).json({ error: "A positive amount is required" }); return; }
    await ensureWallet(req.userId);
    // کسر مشروط در یک دستور — همان دلیلِ `deductWallet` در `routes/bots.ts`:
    // «بخوان، چک کن، بنویس» اجازه می‌داد دو خرجِ هم‌زمان هر دو رد شوند و
    // موجودی منفی یا یکی از کسرها گم شود.
    const [updated] = await db.update(walletsTable)
      .set({ balance: sql`${walletsTable.balance} - ${Math.round(amt)}` })
      .where(and(eq(walletsTable.userId, req.userId), gte(walletsTable.balance, Math.round(amt))))
      .returning();
    if (!updated) {
      res.status(400).json({ error: "Insufficient wallet balance", code: "insufficient" });
      return;
    }
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
    const [exists] = await db.select({ id: walletTransactionsTable.id })
      .from(walletTransactionsTable)
      .where(eq(walletTransactionsTable.id, req.params.txId)).limit(1);
    if (!exists) { res.status(404).json({ error: "Transaction not found" }); return; }

    /**
     * گذارِ وضعیت **اتمیک** است، نه «بخوان، چک کن، بنویس».
     *
     * قبلاً وضعیت خوانده می‌شد، با `pending` مقایسه می‌شد، و بعد آپدیت
     * می‌شد. دو تأییدِ هم‌زمان (دو تب، یا دوبار کلیک روی دکمه) هر دو
     * `pending` می‌خواندند، هر دو رد می‌شدند، و کیف پول **دو بار** شارژ
     * می‌شد. با گذاشتن شرط در خودِ `WHERE`، دیتابیس داور می‌شود و فقط یکی
     * ردیف برمی‌گرداند.
     */
    const [tx] = await db.update(walletTransactionsTable)
      .set({ status: "approved", reviewedBy: req.userId, reviewNote: req.body?.reviewNote ?? null })
      .where(and(
        eq(walletTransactionsTable.id, req.params.txId),
        eq(walletTransactionsTable.status, "pending"),
      ))
      .returning();
    if (!tx) { res.status(400).json({ error: "Already reviewed" }); return; }

    await ensureWallet(tx.userId);
    // افزایش در خودِ SQL، نه `موجودیِ خوانده‌شده + مبلغ`: آن شکل، خرجی که
    // بین خواندن و نوشتن انجام شده باشد را پاک می‌کرد (lost update).
    const [updated] = await db.update(walletsTable)
      .set({ balance: sql`${walletsTable.balance} + ${tx.amount}` })
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
