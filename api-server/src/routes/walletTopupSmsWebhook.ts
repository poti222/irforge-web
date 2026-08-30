/**
 * routes/walletTopupSmsWebhook.ts — تشخیصِ خودکارِ واریزِ بلوبانک از رویِ پیامک.
 * ─────────────────────────────────────────────────────────────────────────────
 * صاحبِ سایت مدارکِ رسمیِ کسب‌وکار برای یک درگاهِ واقعی ندارد، پس شارژِ
 * کیف‌پول با یک لینکِ بازِ بلوبانک انجام می‌شود و تأییدش هم به‌جایِ callback
 * درگاه، از رویِ پیامکِ واریزیِ بانک است — یک اپِ SMS-forwarder روی گوشیِ او
 * هر پیامکِ رسیده را با یک POST به اینجا می‌فرستد.
 *
 * همان الگویِ webhookِ داخلیِ `internalTicketNotify.ts` (راز مشترک +
 * timingSafeEqual + rate limit + audit) ولی با رازِ **جدا**
 * (`SMS_WEBHOOK_SECRET`) — لو رفتنِ یک راز نباید قابلیتِ یک endpoint نامرتبط
 * را هم بدهد.
 *
 * منطقِ تطبیق «همان انتقالِ اتمیکِ شرطی»یِ همیشگیِ این کدبیس است: تغییرِ
 * وضعیت از `pending` به `confirmed` در خودِ WHERE شرط می‌خورد
 * (`lib/wallet.ts`'s `deductWallet` و `routes/wallet.ts`'s تأییدِ واریز هم
 * دقیقاً همین‌طورند) — یعنی همان پیامک را دوبار فرستادن (retry اپِ
 * forwarder) نمی‌تواند دوبار شارژ بزند: بارِ دوم چیزی برای آپدیت پیدا
 * نمی‌کند چون سفارش دیگر `pending` نیست.
 *
 * به کیف‌پول `requestedAmount` واریز می‌شود، نه `finalAmount` — پسوندِ
 * سه‌رقمی فقط برایِ تطبیق است، جزوِ پولِ واقعی نیست.
 */
import { Router } from "express";
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db, walletTopupsTable, smsLogsTable, type WalletTopup } from "@workspace/db";
import { logger } from "../lib/logger";
import { authRateLimit, clientIp } from "../middleware/rateLimit";
import { writeAudit } from "../lib/audit";
import { createNotification, formatTomanFa } from "../lib/notify";
import { creditWallet } from "../lib/wallet";
import { parseBlubankDepositSms } from "../lib/walletTopupService";

const router = Router();

function secretOk(req: any): boolean {
  const provided = req.header("X-Sms-Webhook-Secret") ?? "";
  const expected = process.env.SMS_WEBHOOK_SECRET ?? "";
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  return (
    expected.length > 0 &&
    providedBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(providedBuf, expectedBuf)
  );
}

router.post("/internal/wallet-topup/sms-webhook", authRateLimit("wallet_topup_sms_webhook"), async (req: any, res) => {
  if (!secretOk(req)) {
    logger.warn({ ip: clientIp(req) }, "Wallet topup SMS webhook: bad or missing secret");
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const rawText = String(req.body?.text ?? req.body?.message ?? "").slice(0, 2000).trim();
    const sender = req.body?.sender ? String(req.body.sender).slice(0, 120) : null;
    if (!rawText) {
      res.status(400).json({ error: "text لازم است" });
      return;
    }

    const parsed = parseBlubankDepositSms(rawText);
    const smsLogId = crypto.randomUUID();
    let matchedTopup: WalletTopup | null = null;

    if (parsed) {
      const [row] = await db.update(walletTopupsTable)
        .set({ status: "confirmed", confirmedAt: new Date(), matchedSmsId: smsLogId })
        .where(and(
          eq(walletTopupsTable.finalAmount, parsed.amountToman),
          eq(walletTopupsTable.status, "pending"),
        ))
        .returning();
      matchedTopup = row ?? null;
    }

    // چه match بشود چه نه، هر پیامک برای ممیزی/رسیدگیِ دستی ثبت می‌شود.
    await db.insert(smsLogsTable).values({
      id: smsLogId,
      rawText,
      sender,
      parsedAmount: parsed?.amountToman ?? null,
      matchedPaymentId: matchedTopup?.id ?? null,
      webhookIp: clientIp(req),
    });

    if (matchedTopup) {
      const balance = await creditWallet(
        matchedTopup.userId,
        matchedTopup.requestedAmount,
        `شارژ خودکار کیف‌پول از طریق بلوبانک (سفارش ${matchedTopup.id})`,
        "deposit_blubank",
      );

      await createNotification({
        userId: matchedTopup.userId,
        type: "wallet_topup_confirmed",
        severity: "info",
        title: "شارژ کیف پول تأیید شد",
        message: `واریز ${formatTomanFa(matchedTopup.requestedAmount)} با موفقیت تأیید شد و به کیف پول اضافه شد. موجودی فعلی: ${formatTomanFa(balance)}.`,
        refId: matchedTopup.id,
      });

      await writeAudit({
        actorUserId: "system:sms-webhook",
        action: "wallet_topup_confirmed",
        targetUserId: matchedTopup.userId,
        metadata: {
          topupId: matchedTopup.id,
          requestedAmount: matchedTopup.requestedAmount,
          finalAmount: matchedTopup.finalAmount,
          smsLogId,
          sourceIp: clientIp(req),
        },
      });
    } else {
      logger.warn({ parsedAmount: parsed?.amountToman ?? null, smsLogId }, "Wallet topup SMS: no matching pending order");
    }

    res.status(201).json({ ok: true, matched: !!matchedTopup });
  } catch (err) {
    logger.error({ err }, "Wallet topup SMS webhook error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
