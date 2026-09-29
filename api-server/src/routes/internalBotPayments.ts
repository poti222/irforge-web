/**
 * routes/internalBotPayments.ts — API داخلیِ مین‌بات ← سایت برای پرداختِ کارت‌به‌کارتِ
 * باتِ فروشنده‌ها (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۵).
 *
 * همان شکلِ `internalTicketNotify.ts`: secretِ مشترکِ سرویس‌به‌سرویس در هدر
 * (`X-Payment-Internal-Secret` ↔ env `PAYMENT_INTERNAL_SECRET`، constant-time)، **جدا**
 * از secretهای purge/ticket تا لو رفتنِ یکی، قابلیتِ دیگری نشود. مین‌بات tenantِ جاری را
 * با `spreadsheetId` (از contextِ خودش، نه ورودیِ کاربر) اعلام می‌کند و سایت آن را به
 * `botId` resolve می‌کند؛ از آن پس **همه‌چیز** به همان botId محدود است
 * (`lib/paymentBotApi.ts`) — یک بات هرگز درخواستِ بات دیگر را نمی‌بیند/تغییر نمی‌دهد.
 *
 * همه‌ی مسیرها POST/JSON‌اند. مبالغ عدد صحیحِ **ریال**اند (تبدیلِ تومان↔ریال با بات).
 * شماره‌کارت فقط در پاسخِ `create`/`get`/`list`/`receipt` برای درخواست‌های pending/
 * awaiting_review برمی‌گردد و هرگز لاگ نمی‌شود.
 *
 * secret غلط → ۴۰۳ (و شمارشِ IP؛ بعد از چند تلاشِ ناموفق ۴۲۹). بدونِ rate-limit روی
 * تماس‌های موفق: بات برای شمارنده‌ی زنده‌ی درخواست‌ها poll می‌کند.
 */
import crypto from "crypto";
import { Router } from "express";
import type { Request, Response } from "express";
import { pool as defaultPool } from "@workspace/db";
import { logger } from "../lib/logger";
import { clientIp, hit, send429, type HitFn } from "../middleware/rateLimit";
import { resolveBotBySpreadsheetId } from "../lib/botConfig";
import {
  cancelBotPayment, claimBotEffect, createBotPayment, decideBotPayment, getActiveBotChannel, getBotPayment,
  listActiveBotPayments, listBotWork, listUnclaimedConfirmed, markBotEffectDone, submitBotReceipt,
  PaymentRequestError, type PaymentPurpose,
} from "../lib/paymentBotApi";
import type { PoolLike } from "../lib/paymentRequests";
import type { MatchAlerts } from "../lib/paymentAlerts";
import { defaultPaymentAlerts } from "./paymentSmsWebhook";

const FAIL_LIMIT = 20;
const FAIL_WINDOW_MS = 15 * 60_000;

const USER_ID_RE = /^\d{1,20}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ORDER_ID_RE = /^[\w.:-]{1,64}$/;
const MAX_RIAL = 10_000_000_000_000;

const STATUS_BY_CODE: Record<string, number> = {
  not_found: 404,
  wrong_state: 409,
  active_request_exists: 409,
  active_request_limit: 409,
  no_channel: 409,
  channel_not_found: 409,
  channel_inactive: 409,
  invalid_amount: 400,
  amount_below_minimum: 400,
  invalid_order: 400,
  invalid_receipt: 400,
  invalid_admin: 400,
  no_effect: 409,
  card_unavailable: 500,
};

class BadInput extends Error {}

function secretOk(req: Request): boolean {
  const provided = Buffer.from(req.header("X-Payment-Internal-Secret") ?? "");
  const expected = Buffer.from(process.env.PAYMENT_INTERNAL_SECRET ?? "");
  return expected.length > 0 && provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

function str(v: unknown, re: RegExp, name: string): string {
  const s = typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
  if (!re.test(s)) throw new BadInput(`${name} نامعتبر است.`);
  return s;
}

function rial(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,15}$/.test(v.trim()) ? Number(v.trim()) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0 || n > MAX_RIAL) throw new BadInput("baseAmountRial باید عددِ صحیحِ مثبتِ ریال باشد.");
  return n;
}

export interface InternalBotPaymentsDeps {
  pool?: PoolLike;
  hitFn?: HitFn;
  resolveBot?: (spreadsheetId: string) => Promise<{ botId: string } | null>;
  alerts?: MatchAlerts;
}

export function createInternalBotPaymentsRouter(deps: InternalBotPaymentsDeps = {}): Router {
  const pool = deps.pool ?? (defaultPool as unknown as PoolLike);
  const hitFn = deps.hitFn ?? hit;
  const resolveBot = deps.resolveBot ?? resolveBotBySpreadsheetId;
  let alerts = deps.alerts;
  const getAlerts = () => (alerts ??= defaultPaymentAlerts());
  const router = Router();

  /** secret → tenant → handler. `botId` فقط از `resolveBot` می‌آید. */
  const route = (
    path: string,
    handler: (ctx: { botId: string; body: any }) => Promise<unknown>,
    okStatus = 200,
  ) => {
    router.post(path, async (req: Request, res: Response) => {
      const ip = clientIp(req);
      try {
        if (!secretOk(req)) {
          const v = await hitFn(`pay-int-fail:${ip}`, FAIL_LIMIT, 0, FAIL_WINDOW_MS);
          logger.warn({ ip, path }, "internal bot payments: bad or missing secret");
          if (!v.allowed) { send429(res, v.retryAfterSeconds); return; }
          res.status(403).json({ error: "Forbidden" });
          return;
        }
        const body = req.body ?? {};
        const spreadsheetId = str(body.spreadsheetId, /^[\w-]{5,128}$/, "spreadsheetId");
        const bot = await resolveBot(spreadsheetId);
        if (!bot) { res.status(404).json({ error: "Bot not found for this spreadsheetId", code: "bot_not_found" }); return; }
        const out = await handler({ botId: bot.botId, body });
        res.status(okStatus).json({ ok: true, ...(out as object) });
      } catch (err) {
        if (err instanceof BadInput) { res.status(400).json({ error: err.message, code: "bad_input" }); return; }
        if (err instanceof PaymentRequestError) {
          const status = STATUS_BY_CODE[err.code] ?? 400;
          if (status >= 500) logger.error({ code: err.code, path }, "internal bot payments: server-side payment error");
          res.status(status).json({ error: err.message, code: err.code });
          return;
        }
        logger.error({ err, path }, "internal bot payments error");
        res.status(500).json({ error: "Internal server error" });
      }
    });
  };

  // بدونِ tenant: همه‌ی کارهای بازِ همه‌ی بات‌ها (فقط secret). بات هر tenant را با spreadsheetId می‌شناسد.
  router.post("/internal/payments/work", async (req: Request, res: Response) => {
    const ip = clientIp(req);
    try {
      if (!secretOk(req)) {
        const v = await hitFn(`pay-int-fail:${ip}`, FAIL_LIMIT, 0, FAIL_WINDOW_MS);
        logger.warn({ ip, path: "/internal/payments/work" }, "internal bot payments: bad or missing secret");
        if (!v.allowed) { send429(res, v.retryAfterSeconds); return; }
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      res.json({ ok: true, items: await listBotWork(pool) });
    } catch (err) {
      logger.error({ err }, "internal bot payments work error");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  route("/internal/payments/channel", async ({ botId }) => ({ channel: await getActiveBotChannel(pool, botId) }));

  route("/internal/payments/requests/create", async ({ botId, body }) => {
    const purpose = body.purpose === "wallet_topup" || body.purpose === "order" ? (body.purpose as PaymentPurpose) : null;
    if (!purpose) throw new BadInput("purpose نامعتبر است.");
    const userId = str(body.userId, USER_ID_RE, "userId");
    const orderId = body.orderId == null || body.orderId === "" ? null : str(body.orderId, ORDER_ID_RE, "orderId");
    const channelId = body.channelId == null || body.channelId === "" ? null : str(body.channelId, REQUEST_ID_RE, "channelId");
    const r = await createBotPayment(pool, {
      botId, userId, purpose, orderId, baseAmountRial: rial(body.baseAmountRial), channelId, alerts: getAlerts(),
    });
    logger.info(
      { botId, requestId: r.payment.id, purpose, status: r.payment.status, finalAmountRial: r.payment.finalAmountRial, existing: r.existing },
      "bot payment request created",
    );
    return { payment: r.payment, existing: r.existing };
  }, 201);

  route("/internal/payments/requests/get", async ({ botId, body }) => {
    const payment = await getBotPayment(pool, botId, str(body.requestId, REQUEST_ID_RE, "requestId"));
    if (!payment) throw new PaymentRequestError("درخواست پیدا نشد.", "not_found");
    return { payment };
  });

  route("/internal/payments/requests/list", async ({ botId, body }) => ({
    payments: await listActiveBotPayments(pool, botId, {
      userId: body.userId == null || body.userId === "" ? undefined : str(body.userId, USER_ID_RE, "userId"),
    }),
  }));

  route("/internal/payments/requests/receipt", async ({ botId, body }) => {
    const payment = await submitBotReceipt(pool, {
      botId,
      userId: str(body.userId, USER_ID_RE, "userId"),
      requestId: str(body.requestId, REQUEST_ID_RE, "requestId"),
      receiptFileId: typeof body.receiptFileId === "string" ? body.receiptFileId : "",
      alerts: getAlerts(),
    });
    logger.info({ botId, requestId: payment.id, status: payment.status }, "bot payment receipt submitted");
    return { payment };
  });

  route("/internal/payments/requests/cancel", async ({ botId, body }) => {
    const r = await cancelBotPayment(pool, {
      botId,
      userId: str(body.userId, USER_ID_RE, "userId"),
      requestId: str(body.requestId, REQUEST_ID_RE, "requestId"),
    });
    logger.info({ botId, requestId: r.payment.id, promoted: r.promoted.map((p) => p.id) }, "bot payment request canceled");
    return { payment: r.payment, promotedIds: r.promoted.map((p) => p.id) };
  });

  route("/internal/payments/requests/decide", async ({ botId, body }) => {
    const decision = body.decision === "approve" || body.decision === "reject" ? body.decision : null;
    if (!decision) throw new BadInput("decision باید approve یا reject باشد.");
    const adminId = str(body.adminId, USER_ID_RE, "adminId");
    const reason = body.reason == null ? null : typeof body.reason === "string" ? body.reason.slice(0, 2000) : null;
    const r = await decideBotPayment(pool, {
      botId, requestId: str(body.requestId, REQUEST_ID_RE, "requestId"), decision, adminId, reason,
    });
    logger.info(
      { botId, requestId: r.payment.id, decision, decided: r.decided, status: r.payment.status, adminId },
      "bot payment admin decision",
    );
    return { decided: r.decided, payment: r.payment, promotedIds: r.promoted.map((p) => p.id) };
  });

  route("/internal/payments/requests/unclaimed", async ({ botId }) => ({
    payments: await listUnclaimedConfirmed(pool, botId),
  }));

  route("/internal/payments/requests/claim", async ({ botId, body }) => {
    const payment = await claimBotEffect(pool, { botId, requestId: str(body.requestId, REQUEST_ID_RE, "requestId") });
    if (payment) logger.info({ botId, requestId: payment.id }, "bot payment effect claimed");
    // claim نشد = قبلاً claim شده یا هنوز confirmed نیست — خطا نیست، بات نباید اثر را اعمال کند.
    return { claimed: Boolean(payment), payment };
  });

  route("/internal/payments/requests/effect-done", async ({ botId, body }) => {
    const done = await markBotEffectDone(pool, { botId, requestId: str(body.requestId, REQUEST_ID_RE, "requestId") });
    return { done };
  });

  return router;
}

export default createInternalBotPaymentsRouter();
