/**
 * routes/walletTopupSmsWebhook.ts — aliasِ سازگاریِ آدرسِ قدیمیِ پیامکِ شارژِ کیف‌پولِ پلتفرم
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۸).
 *
 * تا پیش از فاز ۸ این فایل خودش پیامکِ بلوبانک را پارس و سفارشِ `wallet_topups` را تأیید می‌کرد. آن منطق **حذف شد**:
 * حالا همه‌ی پیامک‌ها از یک pipeline می‌گذرند (`paymentSmsWebhook.ts::processAuthenticatedSms` → ذخیره در `sms_inbox`،
 * تطبیق با `payment_requests`، شارژِ کیف‌پول داخلِ تراکنشِ تأیید).
 *
 * این aliasِ نازک فقط برایِ **قطعِ نشدنِ گوشیِ فعلیِ صاحبِ سایت** هنگامِ استقرار مانده است: گوشی هنوز به
 * `POST /internal/wallet-topup/sms-webhook` با هدرِ `X-Sms-Webhook-Secret` (env: `SMS_WEBHOOK_SECRET`) پست می‌کند.
 * پیامک به «کانالِ فعالِ پلتفرم» (تازه‌ترین) می‌رود و دقیقاً مثلِ آدرسِ جدید پردازش می‌شود. **منسوخ**: بعد از اینکه
 * در پنلِ ادمین (کارت‌به‌کارت خودکار ← کانال‌های پلتفرم) وبهوکِ جدید و کلیدِ تازه را روی گوشی گذاشتید،
 * `SMS_WEBHOOK_SECRET` را از env حذف کنید تا این alias خاموش شود (بدونِ آن، همیشه ۴۰۳ می‌دهد).
 */
import { Router } from "express";
import crypto from "crypto";
import { pool as defaultPool } from "@workspace/db";
import { logger } from "../lib/logger";
import { authRateLimit, clientIp, hit, type HitFn } from "../middleware/rateLimit";
import type { MatchAlerts } from "../lib/paymentAlerts";
import { matchSms } from "../lib/paymentMatcher";
import { logPaymentEvent } from "../lib/paymentEvents";
import { SmsIngestError, type SmsChannelRow } from "../lib/smsIngest";
import type { PoolLike } from "../lib/paymentRequests";
import { defaultPaymentAlerts, processAuthenticatedSms } from "./paymentSmsWebhook";

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

/** تازه‌ترین کانالِ فعالِ پلتفرم (همان که صفحه‌ی کیف‌پول پیش‌فرض می‌گیرد) یا null. */
async function activePlatformChannel(pool: PoolLike): Promise<SmsChannelRow | null> {
  const c = await pool.connect();
  try {
    const { rows } = await c.query(
      `SELECT id, sender_allowlist, bank_parser FROM payment_channels
        WHERE scope = 'platform' AND bot_id IS NULL AND active ORDER BY created_at DESC, id LIMIT 1`);
    const r = rows[0];
    return r ? { id: r.id, scope: "platform", botId: null, active: true, senderAllowlist: r.sender_allowlist ?? [], bankParser: r.bank_parser } : null;
  } finally {
    c.release();
  }
}

export interface LegacyWalletWebhookDeps {
  pool?: PoolLike;
  /** پیش‌فرض: `authRateLimit("wallet_topup_sms_webhook")`. */
  rateLimit?: (req: any, res: any, next: any) => void;
  hitFn?: HitFn;
  alerts?: MatchAlerts;
}

export function createLegacyWalletWebhookRouter(deps: LegacyWalletWebhookDeps = {}): Router {
  const router = Router();
  const pool = deps.pool ?? (defaultPool as unknown as PoolLike);
  const hitFn = deps.hitFn ?? hit;
  const rateLimit = deps.rateLimit ?? authRateLimit("wallet_topup_sms_webhook");

  router.post("/internal/wallet-topup/sms-webhook", rateLimit, async (req: any, res) => {
    if (!secretOk(req)) {
      logger.warn({ ip: clientIp(req) }, "Wallet topup SMS webhook (legacy alias): bad or missing secret");
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    try {
      const text = String(req.body?.text ?? req.body?.message ?? "").slice(0, 2000).trim();
      if (!text) { res.status(400).json({ error: "text لازم است" }); return; }
      const channel = await activePlatformChannel(pool);
      if (!channel) {
        logger.error("Wallet topup SMS webhook (legacy alias): no active platform channel — SMS not stored");
        res.status(503).json({ error: "No active platform payment channel" });
        return;
      }
      // یادآوریِ «منسوخ» را در لاگِ ادمین بگذار، ولی حداکثر ساعتی یک‌بار.
      if ((await hitFn("legacy-wallet-webhook-log", 1, 0, 3_600_000)).allowed) {
        await logPaymentEvent(pool, {
          level: "warn", kind: "legacy_webhook_used", scope: "platform", channelId: channel.id, actor: "sms",
          message: "پیامک از آدرسِ قدیمیِ /internal/wallet-topup/sms-webhook رسید؛ وبهوکِ جدیدِ کانال را روی گوشی بگذارید",
        });
      }
      const alerts = deps.alerts ?? defaultPaymentAlerts(pool);
      const out = await processAuthenticatedSms(
        pool, channel, { text, sender: req.body?.sender ? String(req.body.sender).slice(0, 120) : null },
        (p, id) => matchSms(p, id, { alerts }),
      );
      res.status(out.inserted ? 201 : 200).json({ ok: true, matched: out.body.matched === true });
    } catch (err) {
      if (err instanceof SmsIngestError) { res.status(400).json({ error: err.message }); return; }
      logger.error({ err }, "Wallet topup SMS webhook (legacy alias) error");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}

export default createLegacyWalletWebhookRouter();
