/**
 * routes/walletTopup.ts — شارژِ کیف‌پول با لینکِ بازِ بلوبانک.
 * ─────────────────────────────────────────────────────────────────────────────
 * جدا از routes/wallet.ts (کارت‌به‌کارت/تتر/برداشتِ دستی، بررسیِ سوپرادمین)
 * چون این مسیر خودکار است: کاربر یک سفارش می‌سازد (مبلغ + پسوندِ یکتا)،
 * دقیقاً همان `finalAmount` را در بلوبانک وارد می‌کند، و تأییدش به‌جای یک
 * ادمین، پیامکِ بانکی (`routes/walletTopupSmsWebhook.ts`) انجام می‌دهد.
 */
import { Router } from "express";
import { desc, eq, and } from "drizzle-orm";
import { db, walletTopupsTable, smsLogsTable, usersTable, type WalletTopup } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireAuth } from "./auth";
import { requireCompleteProfile } from "../lib/profile";
import { blockWhileImpersonating } from "../middleware/impersonation";
import { clientIp } from "../middleware/rateLimit";
import { perUserRateLimit } from "../middleware/rateLimit";
import { getPaymentMethods } from "../lib/platformSettings";
import { creditWallet } from "../lib/wallet";
import { createNotification, formatTomanFa } from "../lib/notify";
import { writeAudit } from "../lib/audit";
import {
  requestTopup,
  getTopupForUser,
  cancelTopup,
  InvalidTopupAmountError,
  TopupSuffixExhaustedError,
  PRESET_TOPUP_AMOUNTS,
  MIN_TOPUP_AMOUNT,
  MAX_TOPUP_AMOUNT,
} from "../lib/walletTopupService";

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

function formatTopup(t: WalletTopup) {
  return {
    id: t.id,
    requestedAmount: t.requestedAmount,
    suffix: t.suffix,
    finalAmount: t.finalAmount,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    expiresAt: t.expiresAt ? t.expiresAt.toISOString() : null,
    confirmedAt: t.confirmedAt ? t.confirmedAt.toISOString() : null,
  };
}

// GET /api/wallet/topup/config — لینک + پیشنهادهای مبلغ.
router.get("/wallet/topup/config", requireAuth, async (_req: any, res) => {
  try {
    const methods = await getPaymentMethods();
    res.json({
      link: methods.blubank.link,
      enabled: methods.blubank.enabled,
      note: methods.blubank.note,
      presets: PRESET_TOPUP_AMOUNTS,
      min: MIN_TOPUP_AMOUNT,
      max: MAX_TOPUP_AMOUNT,
    });
  } catch (err) {
    logger.error({ err }, "Get wallet topup config error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/wallet/topup/request — یک سفارشِ تازه با finalAmount یکتا.
router.post(
  "/wallet/topup/request",
  requireAuth,
  blockWhileImpersonating,
  requireCompleteProfile(),
  perUserRateLimit("wallet_topup_request", 20, 60 * 60 * 1000),
  async (req: any, res) => {
    try {
      const methods = await getPaymentMethods();
      if (!methods.blubank.enabled) {
        res.status(400).json({ error: "شارژ خودکار در حال حاضر غیرفعال است." });
        return;
      }
      const topup = await requestTopup(req.userId, Number(req.body?.amount));
      res.status(201).json({ ...formatTopup(topup), link: methods.blubank.link });
    } catch (err) {
      if (err instanceof InvalidTopupAmountError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof TopupSuffixExhaustedError) {
        res.status(503).json({ error: err.message });
        return;
      }
      logger.error({ err }, "Wallet topup request error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// GET /api/wallet/topup/:id/status — polling تا وقتی وضعیت confirmed/expired/canceled شود.
router.get("/wallet/topup/:id/status", requireAuth, async (req: any, res) => {
  try {
    const topup = await getTopupForUser(req.userId, req.params.id);
    if (!topup) {
      res.status(404).json({ error: "سفارش پیدا نشد" });
      return;
    }
    res.json(formatTopup(topup));
  } catch (err) {
    logger.error({ err }, "Get wallet topup status error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/wallet/topup/:id/cancel
router.post("/wallet/topup/:id/cancel", requireAuth, blockWhileImpersonating, async (req: any, res) => {
  try {
    const topup = await cancelTopup(req.userId, req.params.id);
    if (!topup) {
      res.status(400).json({ error: "این سفارش دیگر قابلِ لغو نیست." });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Cancel wallet topup error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── نظارتِ سوپرادمین (فاز ۵) ─────────────────────────────────────────────────
// تأیید خودکار است (پیامکِ بانکی)، پس این‌ها اساساً برای دیده‌بانی/رفعِ اشکالند
// — مواردی که پیامک هیچ‌وقت نرسیده یا فرمتش تغییر کرده، همان‌جا با
// «manual-confirm» جبران می‌شود.

function formatSmsLog(l: typeof smsLogsTable.$inferSelect) {
  return {
    id: l.id,
    rawText: l.rawText,
    sender: l.sender,
    parsedAmount: l.parsedAmount,
    matchedPaymentId: l.matchedPaymentId,
    receivedAt: l.receivedAt.toISOString(),
  };
}

// GET /api/admin/wallet-topups — آخرین سفارش‌ها (همه‌ی وضعیت‌ها).
router.get("/admin/wallet-topups", requireSuperAdmin, async (_req: any, res) => {
  try {
    const rows = await db.select().from(walletTopupsTable)
      .orderBy(desc(walletTopupsTable.createdAt))
      .limit(200);
    const enriched = await Promise.all(rows.map(async (t: WalletTopup) => {
      const [user] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
        .from(usersTable).where(eq(usersTable.id, t.userId)).limit(1);
      return { ...formatTopup(t), user: user ?? null };
    }));
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "List wallet topups error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/wallet-topup-sms-logs — آخرین پیامک‌ها، match‌شده یا نشده.
router.get("/admin/wallet-topup-sms-logs", requireSuperAdmin, async (_req: any, res) => {
  try {
    const rows = await db.select().from(smsLogsTable)
      .orderBy(desc(smsLogsTable.receivedAt))
      .limit(200);
    res.json(rows.map(formatSmsLog));
  } catch (err) {
    logger.error({ err }, "List wallet topup SMS logs error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/wallet-topups/:id/manual-confirm — پیامک هیچ‌وقت نرسید ولی
// پول واقعاً واریز شده؛ سوپرادمین دستی تأیید می‌کند. همان انتقالِ اتمیکِ
// شرطی (pending -> confirmed در خودِ WHERE) که webhook هم استفاده می‌کند.
router.post("/admin/wallet-topups/:id/manual-confirm", requireSuperAdmin, async (req: any, res) => {
  try {
    const [topup] = await db.update(walletTopupsTable)
      .set({ status: "confirmed", confirmedAt: new Date() })
      .where(and(eq(walletTopupsTable.id, req.params.id), eq(walletTopupsTable.status, "pending")))
      .returning();
    if (!topup) {
      res.status(400).json({ error: "این سفارش pending نیست." });
      return;
    }

    const balance = await creditWallet(
      topup.userId,
      topup.requestedAmount,
      `تأییدِ دستیِ سوپرادمین برایِ سفارشِ شارژِ بلوبانک ${topup.id}`,
      "deposit_blubank",
    );

    await createNotification({
      userId: topup.userId,
      type: "wallet_topup_confirmed",
      severity: "info",
      title: "شارژ کیف پول تأیید شد",
      message: `واریز ${formatTomanFa(topup.requestedAmount)} تأیید شد و به کیف پول اضافه شد. موجودی فعلی: ${formatTomanFa(balance)}.`,
      refId: topup.id,
    });

    await writeAudit({
      actorUserId: req.userId,
      action: "wallet_topup_confirmed",
      targetUserId: topup.userId,
      metadata: { topupId: topup.id, requestedAmount: topup.requestedAmount, finalAmount: topup.finalAmount, manual: true, sourceIp: clientIp(req) },
    });

    res.json({ success: true, balance });
  } catch (err) {
    logger.error({ err }, "Manual confirm wallet topup error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
