/**
 * routes/paymentSmsWebhook.ts — `POST /api/payments/sms/:channelId`
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۳).
 *
 * گوشیِ صاحبِ کارت (اندروید + MacroDroid یا SMS Forwarder) هر پیامکِ بانک را به
 * اینجا POST می‌کند. هر کانالِ پرداخت secretِ خودش را دارد (فقط هشش ذخیره
 * می‌شود) — لو رفتنِ secretِ یک فروشنده به کانالِ فروشنده‌ی دیگر یا به
 * `/internal/wallet-topup/sms-webhook` (با `SMS_WEBHOOK_SECRET`ِ سراسری) راه
 * نمی‌دهد. (فاز ۸: منطقِ قدیمیِ آن حذف شد؛ آدرسِ قدیمی فقط یک alias است که به همین pipeline می‌رسد —
 * `walletTopupSmsWebhook.ts`.)
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
 * پس از ذخیره‌ی یک واریزِ قابل‌فهم، موتورِ تطبیق (`lib/paymentMatcher.ts`، فاز ۴) صدا زده
 * می‌شود؛ پاسخ `matched:true` است اگر یک درخواست خودکار تأیید شد. خطای تطبیق هرگز پاسخ را
 * خراب نمی‌کند (پیامک unmatched می‌ماند).
 *
 * پاسخ: 201 ذخیره شد، 200 تکراری (idempotent — forwarder می‌تواند امن retry کند)،
 * 400 بدونِ متن، 401 احراز ناموفق، 403 کانالِ غیرفعال، 429 rate limit.
 */
import express, { Router } from "express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { pool as defaultPool, db, botsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { createNotification, notifySuperAdmins } from "../lib/notify";
import { logPaymentEvent } from "../lib/paymentEvents";
import { createPaymentAlerts, type AlertMessage, type AlertNotifiers, type MatchAlerts } from "../lib/paymentAlerts";
import { matchSms, type MatchOutcome } from "../lib/paymentMatcher";
import { registerDefaultPaymentEffects } from "../lib/paymentEffectsBoot";
import { clientIp, hit, send429, type HitFn } from "../middleware/rateLimit";
import { authenticateChannel, ingestSms, SmsIngestError, type SmsChannelRow } from "../lib/smsIngest";
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

/** کانال‌های اعلان: super_adminها (همیشه)، صاحبِ بات (scope=bot)، خودِ کاربرِ سایت (شارژِ کیف‌پول). هرگز throw نمی‌کند. */
export function defaultPaymentNotifiers(pool: PoolLike = defaultPool as unknown as PoolLike): AlertNotifiers {
  const toInput = (m: AlertMessage) => ({
    type: m.type, severity: m.severity, title: m.title, message: m.message,
    botId: m.botId, dedupeKey: m.dedupeKey, refId: m.refId ?? null,
  });
  return {
    record: (ev) => logPaymentEvent(pool, ev),
    notifyPlatformUser: (userId, m) => createNotification({ ...toInput(m), userId }),
    notifyAdmins: (m) => notifySuperAdmins(toInput(m)),
    notifyBotOwner: async (botId, m) => {
      const [bot] = await db.select({ userId: botsTable.userId }).from(botsTable).where(eq(botsTable.id, botId)).limit(1);
      if (bot) await createNotification({ ...toInput(m), userId: bot.userId });
    },
  };
}

export function defaultPaymentAlerts(pool: PoolLike = defaultPool as unknown as PoolLike): MatchAlerts {
  return createPaymentAlerts(defaultPaymentNotifiers(pool));
}

registerDefaultPaymentEffects();

export function createPaymentSmsRouter(
  deps: { pool?: PoolLike; hitFn?: HitFn; matcher?: (pool: PoolLike, smsId: string) => Promise<MatchOutcome> } = {},
): Router {
  const pool = deps.pool ?? (defaultPool as unknown as PoolLike);
  const hitFn = deps.hitFn ?? hit;
  const alerts = deps.matcher ? undefined : defaultPaymentAlerts();
  const matcher = deps.matcher ?? ((p: PoolLike, id: string) => matchSms(p, id, { alerts }));
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
          // لاگِ ادمین: ورودیِ ناشناس نباید جدولِ رویداد را پر کند → حداکثر ۳ رویداد در دقیقه به‌ازای هر IP.
          if ((await hitFn(`sms-ip:authfail-log:${ip}`, 3, 0, MINUTE)).allowed) {
            await logPaymentEvent(pool, {
              level: "warn", kind: "sms_auth_failed", channelId: CHANNEL_ID_RE.test(channelId) ? channelId : null, actor: "sms",
              message: "احرازِ وبهوکِ پیامک ناموفق بود (secretِ غلط یا کانالِ ناموجود)", data: { ip },
            });
          }
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

        const out = await processAuthenticatedSms(pool, channel, { text, sender, time }, matcher);
        res.status(out.inserted ? 201 : 200).json(out.body);
      } catch (err) {
        if (err instanceof SmsIngestError) { res.status(400).json({ error: err.message, code: err.code }); return; }
        logger.error({ err }, "payment SMS webhook error");
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  return router;
}

/**
 * پس از احرازِ کانال: ذخیره‌ی پیامک، ثبتِ رویداد (بدونِ متنِ خام) و تطبیق. مشترکِ webhookِ کانال و aliasِ قدیمیِ
 * `/internal/wallet-topup/sms-webhook`؛ پس **یک pipeline** برای همه‌ی پیامک‌ها هست، نه دو منطقِ موازی.
 */
export async function processAuthenticatedSms(
  pool: PoolLike,
  channel: SmsChannelRow,
  payload: { text: unknown; sender?: unknown; time?: unknown },
  matcher: (pool: PoolLike, smsId: string) => Promise<MatchOutcome>,
): Promise<{ inserted: boolean; body: Record<string, unknown> }> {
  const result = await ingestSms(pool, channel, payload);
  logger.info(
    { channelId: channel.id, smsId: result.id || undefined, inserted: result.inserted, status: result.status,
      direction: result.direction, parsedOk: result.parsedOk },
    "payment SMS ingested",
  );
  await logPaymentEvent(pool, {
    kind: result.inserted ? "sms_received" : "sms_duplicate", scope: channel.scope, botId: channel.botId,
    channelId: channel.id, smsId: result.id || null, actor: "sms",
    message: result.inserted
      ? `پیامکِ ${result.direction === "deposit" ? "واریز" : result.direction === "withdraw" ? "برداشت" : "نامشخص"} دریافت شد (${result.status})`
      : "پیامکِ تکراری (نادیده)",
    data: { status: result.status, direction: result.direction, parsedOk: result.parsedOk, amountRial: result.amountRial },
  });

  // تطبیق فقط برایِ واریزِ تازه‌ی قابل‌فهم؛ خطایش هرگز پاسخِ وبهوک را خراب نمی‌کند
  // (پیامک ذخیره شده و unmatched می‌ماند تا retest/sweeper).
  let matched = false;
  if (result.inserted && result.status === "unmatched" && result.parsedOk && result.direction === "deposit") {
    try {
      const outcome = await matcher(pool, result.id);
      matched = outcome.outcome === "confirmed";
      if (outcome.outcome === "no_candidate") {
        await logPaymentEvent(pool, {
          kind: "sms_no_candidate", scope: channel.scope, botId: channel.botId, channelId: channel.id, smsId: result.id,
          actor: "system", message: "واریز دریافت شد ولی درخواستِ فعالِ هم‌مبلغ پیدا نشد", data: { amountRial: result.amountRial },
        });
      }
    } catch (err) {
      logger.error({ err, channelId: channel.id, smsId: result.id }, "payment SMS matching failed (SMS kept unmatched)");
      await logPaymentEvent(pool, {
        level: "error", kind: "match_error", scope: channel.scope, botId: channel.botId, channelId: channel.id,
        smsId: result.id, actor: "system", message: "تطبیقِ پیامک با خطا مواجه شد؛ پیامک unmatched ماند",
      });
    }
  }
  return {
    inserted: result.inserted,
    body: {
      ok: true,
      duplicate: !result.inserted,
      status: result.status,
      direction: result.direction,
      parsed: result.parsedOk,
      matched,
    },
  };
}

export default createPaymentSmsRouter();
