/**
 * routes/walletTopup.ts — شارژِ کیف‌پولِ IrForge روی ماژولِ مشترکِ کارت‌به‌کارت
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۸؛ scope=platform).
 *
 * URLها همان‌هایی‌اند که صفحه‌ی کیف‌پول از قبل می‌شناخت، ولی منطقِ قدیمی (`wallet_topups` / `sms_logs` /
 * `walletTopupService.ts`) حذف شده و همه‌چیز روی `payment_requests` است:
 *
 *   GET    /wallet/topup/config           کانال‌های فعال + پیش‌ست‌ها + حداقل/حداکثر (تومان)
 *   GET    /wallet/topup                  تاریخچه‌ی اخیرِ خودِ کاربر
 *   POST   /wallet/topup/request          {amount (تومان)، channelId?} → درخواستِ تازه (مبلغِ نهایی یکتا)
 *   GET    /wallet/topup/:id/status       polling (منقضی‌شدن را هم اعمال می‌کند)
 *   POST   /wallet/topup/:id/receipt      {receiptUrl: data-URL تصویر} → منتظرِ بررسیِ دستیِ ادمین
 *   POST   /wallet/topup/:id/cancel       فقط queued/pending
 *
 * مدیریت/نظارتِ سوپرادمین: `routes/adminCardAutoConfirm.ts`. تأییدِ خودکار با پیامک (`paymentSmsWebhook.ts`).
 * scope همیشه platform است (از ورودی نمی‌آید)؛ هر query با `user_id` = کاربرِ واردشده فیلتر می‌شود. شماره‌کارتِ کامل
 * فقط داخلِ یک درخواستِ فعالِ خودِ کاربر برمی‌گردد.
 */
import { Router } from "express";
import { pool as defaultPool } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireAuth } from "./auth";
import { requireCompleteProfile } from "../lib/profile";
import { blockWhileImpersonating } from "../middleware/impersonation";
import { hit, perUserRateLimit, type HitFn } from "../middleware/rateLimit";
import { notifySuperAdmins } from "../lib/notify";
import { logPaymentEvent } from "../lib/paymentEvents";
import { PaymentRequestError, type PoolLike } from "../lib/paymentRequests";
import type { BotPaymentView } from "../lib/paymentBotApi";
import {
  cancelPlatformTopup, createPlatformTopup, getPlatformTopup, listActivePlatformChannels, listPlatformTopups,
  submitPlatformReceipt, TOPUP_MAX_TOMAN, TOPUP_MIN_TOMAN, TOPUP_PRESETS_TOMAN,
} from "../lib/platformWallet";
import type { MatchAlerts } from "../lib/paymentAlerts";
import { defaultPaymentAlerts } from "./paymentSmsWebhook";


const HTTP_BY_CODE: Record<string, number> = {
  invalid_amount: 400, amount_below_minimum: 400, invalid_receipt: 400, no_channel: 503, channel_inactive: 503,
  channel_not_found: 404, not_found: 404, wrong_state: 409, active_request_limit: 429, active_request_exists: 409,
};

function fail(res: any, err: unknown, fallback: string): void {
  if (err instanceof PaymentRequestError) {
    res.status(HTTP_BY_CODE[err.code] ?? 400).json({ error: err.message, code: err.code });
    return;
  }
  logger.error({ err }, fallback);
  res.status(500).json({ error: "Internal server error" });
}

/** نمایشِ API: مبلغِ خواسته‌شده تومان؛ `finalAmount` همان ریالِ دقیقی که کاربر باید در بانک وارد کند. */
export function formatPlatformTopup(v: BotPaymentView) {
  return {
    id: v.id,
    status: v.status,
    requestedAmount: Math.round(v.baseAmountRial / 10),
    suffixRial: v.suffixRial,
    finalAmount: v.finalAmountRial,
    createdAt: v.createdAt.toISOString(),
    expiresAt: v.expiresAt ? v.expiresAt.toISOString() : null,
    confirmedAt: v.confirmedAt ? v.confirmedAt.toISOString() : null,
    confirmedBy: v.confirmedBy,
    queuedAhead: v.queuedAhead,
    receiptUploadedAt: v.receiptUploadedAt ? v.receiptUploadedAt.toISOString() : null,
    rejectReason: v.rejectReason,
    channel: v.channel,
  };
}

export interface WalletTopupDeps {
  pool?: PoolLike;
  auth?: (req: any, res: any, next: any) => void;
  /** پیش‌فرض: `requireCompleteProfile()` (به drizzle/users وابسته است). */
  profile?: (req: any, res: any, next: any) => void;
  hitFn?: HitFn;
  alerts?: MatchAlerts;
  /** برای تست: اعلانِ سوپرادمین. */
  notifyAdmins?: typeof notifySuperAdmins;
}

export function createWalletTopupRouter(deps: WalletTopupDeps = {}): Router {
  const router = Router();
  const pool = deps.pool ?? (defaultPool as unknown as PoolLike);
  const auth = deps.auth ?? requireAuth;
  const profile = deps.profile ?? requireCompleteProfile();
  const hitFn = deps.hitFn ?? hit;
  const alerts = deps.alerts ?? defaultPaymentAlerts(pool);
  const notifyAdmins = deps.notifyAdmins ?? notifySuperAdmins;

  router.get("/wallet/topup/config", auth, async (_req: any, res) => {
    try {
      const channels = await listActivePlatformChannels(pool);
      res.json({
        enabled: channels.length > 0,
        channels,
        presets: TOPUP_PRESETS_TOMAN,
        min: TOPUP_MIN_TOMAN,
        max: TOPUP_MAX_TOMAN,
      });
    } catch (err) {
      fail(res, err, "Get wallet topup config error");
    }
  });
  
  router.get("/wallet/topup", auth, async (req: any, res) => {
    try {
      res.json({ items: (await listPlatformTopups(pool, req.userId, 20)).map(formatPlatformTopup) });
    } catch (err) {
      fail(res, err, "List wallet topups error");
    }
  });
  
  router.post(
    "/wallet/topup/request",
    auth,
    blockWhileImpersonating,
    profile,
    perUserRateLimit("wallet_topup_request", 20, 60 * 60 * 1000, hitFn),
    async (req: any, res) => {
      try {
        const channelId = typeof req.body?.channelId === "string" && req.body.channelId ? req.body.channelId : null;
        const { payment, existing } = await createPlatformTopup(pool, {
          userId: req.userId, amountToman: req.body?.amount, channelId, alerts: alerts,
        });
        if (!existing) {
          await logPaymentEvent(pool, {
            kind: "request_created", scope: "platform", channelId: payment.channel.id, requestId: payment.id,
            actor: `user:${req.userId}`, message: `درخواستِ شارژ ${Math.round(payment.baseAmountRial / 10).toLocaleString("en-US")} تومان (${payment.status})`,
            data: { baseAmountRial: payment.baseAmountRial, finalAmountRial: payment.finalAmountRial, status: payment.status },
          });
        }
        res.status(existing ? 200 : 201).json({ ...formatPlatformTopup(payment), existing });
      } catch (err) {
        fail(res, err, "Wallet topup request error");
      }
    },
  );
  
  router.get("/wallet/topup/:id/status", auth, async (req: any, res) => {
    try {
      const v = await getPlatformTopup(pool, req.userId, String(req.params.id));
      if (!v) { res.status(404).json({ error: "سفارش پیدا نشد" }); return; }
      res.json(formatPlatformTopup(v));
    } catch (err) {
      fail(res, err, "Get wallet topup status error");
    }
  });
  
  router.post("/wallet/topup/:id/receipt", auth, blockWhileImpersonating,
    perUserRateLimit("wallet_topup_receipt", 20, 60 * 60 * 1000, hitFn), async (req: any, res) => {
      try {
        const v = await submitPlatformReceipt(pool, {
          userId: req.userId, requestId: String(req.params.id), receiptDataUrl: req.body?.receiptUrl,
          alerts: alerts,
        });
        await logPaymentEvent(pool, {
          kind: "receipt_uploaded", scope: "platform", channelId: v.channel.id, requestId: v.id,
          actor: `user:${req.userId}`, message: "فیش آپلود شد؛ منتظرِ تأییدِ خودکار یا بررسیِ ادمین", data: { status: v.status },
        });
        // اگر پیامک همان لحظه تأیید کرده باشد status=confirmed است؛ وگرنه سوپرادمین باید خبردار شود.
        if (v.status === "awaiting_review") {
          await notifyAdmins({
            type: "admin_topup_receipt", severity: "info", title: "فیشِ شارژِ کیف‌پول در انتظارِ بررسی",
            message: `یک فیش برایِ شارژِ ${Math.round(v.baseAmountRial / 10).toLocaleString("fa-IR")} تومان ثبت شد. اگر پیامکِ بانک تا چند دقیقه نرسید، از «پنل مدیریت ← کارت‌به‌کارت خودکار» بررسی کنید.`,
            refId: v.id,
          }).catch((e) => logger.warn({ err: e }, "topup receipt admin notification failed"));
        }
        res.json(formatPlatformTopup(v));
      } catch (err) {
        fail(res, err, "Wallet topup receipt error");
      }
    });
  
  router.post("/wallet/topup/:id/cancel", auth, blockWhileImpersonating, async (req: any, res) => {
    try {
      const { payment } = await cancelPlatformTopup(pool, { userId: req.userId, requestId: String(req.params.id) });
      await logPaymentEvent(pool, {
        kind: "request_canceled", scope: "platform", channelId: payment.channel.id, requestId: payment.id,
        actor: `user:${req.userId}`, message: "کاربر درخواست را لغو کرد",
      });
      res.json({ success: true });
    } catch (err) {
      fail(res, err, "Cancel wallet topup error");
    }
  });

  return router;
}

export default createWalletTopupRouter();
