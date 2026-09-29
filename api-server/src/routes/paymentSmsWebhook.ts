/**
 * routes/paymentSmsWebhook.ts — `POST /api/payments/sms/:channelId`
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۳).
 *
 * گوشیِ صاحبِ کارت (اندروید + MacroDroid یا SMS Forwarder) هر پیامکِ بانک را به
 * اینجا POST می‌کند. هر کانالِ پرداخت secretِ خودش را دارد (فقط هشش ذخیره
 * می‌شود) — لو رفتنِ secretِ یک فروشنده به کانالِ فروشنده‌ی دیگر یا به
 * `/internal/wallet-topup/sms-webhook` (با `SMS_WEBHOOK_SECRET`ِ سراسری) راه
 * نمی‌دهد. مسیرِ قدیمیِ شارژِ کیف‌پولِ پلتفرم دست‌نخورده می‌ماند (فاز ۸ جایگزینش می‌کند).
 *
 * احراز هویت: هدرِ `X-Sms-Secret: <secret>` یا `Authorization: Bearer <secret>`.
 * کانالِ ناموجود و secretِ غلط **یک پاسخِ یکسان** (401) می‌گیرند تا وجودِ کانال
 * لو نرود. کانالِ غیرفعال (بعد از احرازِ موفق) → 403.
 *
 * بدنه (JSON، x-www-form-urlencoded یا text/plain — خروجیِ MacroDroid/SMS
 * Forwarder فرق می‌کند؛ نام‌های معادل پذیرفته می‌شوند):
 *   متن:      text | message | body | sms | content   (یا خودِ بدنه در text/plain)
 *   فرستنده:  sender | from | address | number
 *   زمان:     time | timestamp | received_at | date   (ISO یا epoch ثانیه/میلی‌ثانیه)
 *
 * پاسخ: 201 ذخیره شد، 200 تکراری (idempotent — forwarder می‌تواند امن retry کند)،
 * 400 بدونِ متن، 401 احراز ناموفق، 403 کانالِ غیرفعال، 429 rate limit.
 */
import express, { Router } from "express";
import type { Request, Response } from "express";
import { pool as defaultPool } from "@workspace/db";
import { logger } from "../lib/logger";
import { clientIp, hit, send429, type HitFn } from "../middleware/rateLimit";
import { authenticateChannel, ingestSms, SmsIngestError } from "../lib/smsIngest";
import type { PoolLike } from "../lib/paymentRequests";

/** سقفِ درخواست به‌ازای IP (پیش از احراز) و به‌ازای کانال (پس از آن) در دقیقه. */
export const SMS_IP_LIMIT_PER_MIN = 30;
export const SMS_CHANNEL_LIMIT_PER_MIN = 120;
const MINUTE = 60_000;

const CHANNEL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function pick(body: any, keys: string[]): unknown {
  if (!body || typeof body !== "object") return undefined;
  for (const k of keys) if (body[k] !== undefined && body[k] !== null && body[k] !== "") return body[k];
  return undefined;
}

function extractSecret(req: Request): string {
  const x = req.header("X-Sms-Secret");
  if (x) return x.trim();
  const auth = req.header("Authorization") ?? "";
  return /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : "";
}

export function createPaymentSmsRouter(deps: { pool?: PoolLike; hitFn?: HitFn } = {}): Router {
  const pool = deps.pool ?? (defaultPool as unknown as PoolLike);
  const hitFn = deps.hitFn ?? hit;
  const router = Router();

  router.post(
    "/payments/sms/:channelId",
    express.text({ type: "text/plain", limit: "16kb" }),
    async (req: Request, res: Response) => {
      const ip = clientIp(req);
      try {
        const ipVerdict = await hitFn(`sms-ip:${ip}`, SMS_IP_LIMIT_PER_MIN, 0, MINUTE);
        if (!ipVerdict.allowed) { send429(res, ipVerdict.retryAfterSeconds); return; }

        const channelId = String(req.params.channelId ?? "");
        const secret = extractSecret(req);
        const channel = CHANNEL_ID_RE.test(channelId) && secret
          ? await authenticateChannel(pool, channelId, secret)
          : null;
        if (!channel) {
          logger.warn({ ip, channelId: channelId.slice(0, 64) }, "payment SMS webhook: auth failed");
          res.status(401).json({ error: "Unauthorized" });
          return;
        }
        if (!channel.active) { res.status(403).json({ error: "Channel inactive" }); return; }

        const chVerdict = await hitFn(`sms-ch:${channel.id}`, SMS_CHANNEL_LIMIT_PER_MIN, 0, MINUTE);
        if (!chVerdict.allowed) { send429(res, chVerdict.retryAfterSeconds); return; }

        const body: any = req.body;
        const text = typeof body === "string" ? body : pick(body, ["text", "message", "body", "sms", "content"]);
        const sender = pick(body, ["sender", "from", "address", "number"]);
        const time = pick(body, ["time", "timestamp", "received_at", "date"]);

        const result = await ingestSms(pool, channel, { text, sender, time });
        logger.info(
          { channelId: channel.id, smsId: result.id || undefined, inserted: result.inserted, status: result.status,
            direction: result.direction, parsedOk: result.parsedOk },
          "payment SMS ingested",
        );
        res.status(result.inserted ? 201 : 200).json({
          ok: true,
          duplicate: !result.inserted,
          status: result.status,
          direction: result.direction,
          parsed: result.parsedOk,
        });
      } catch (err) {
        if (err instanceof SmsIngestError) { res.status(400).json({ error: err.message, code: err.code }); return; }
        logger.error({ err }, "payment SMS webhook error");
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  return router;
}

export default createPaymentSmsRouter();
