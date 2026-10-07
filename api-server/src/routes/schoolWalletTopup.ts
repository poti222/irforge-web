/**
 * routes/schoolWalletTopup.ts — شارژِ «کیف‌پولِ مدرسه» با همان جریانِ کیف‌پولِ شخصی (/wallet/topup/*)، رویِ همان ماژولِ
 * کارت‌به‌کارتِ خودکار؛ فقط مدیرِ همان مدرسه، و فقط به school_wallets اعتبار می‌دهد. URLها آینه‌یِ routes/walletTopup.ts:
 *
 *   GET    /schools/:schoolId/wallet/topup/config        کانال‌هایِ فعالِ platform + پیش‌ست‌ها + حداقل/حداکثر (تومان)
 *   GET    /schools/:schoolId/wallet/topup               تاریخچه‌یِ شارژهایِ همین مدرسه ({ items })
 *   POST   /schools/:schoolId/wallet/topup/request       {amount (تومان)، channelId?}
 *   GET    /schools/:schoolId/wallet/topup/:id/status    polling
 *   POST   /schools/:schoolId/wallet/topup/:id/receipt   {receiptUrl} → منتظرِ بررسیِ دستیِ سوپرادمین
 *   POST   /schools/:schoolId/wallet/topup/:id/cancel    فقط queued/pending
 * بر خلافِ شارژِ شخصی «پروفایلِ کامل» لازم نیست (پول به نامِ مدرسه است نه هویتِ کاربر)؛ بقیه‌یِ محافظ‌ها (rate limit، blockWhileImpersonating) همان‌اند.
 */
import { Router } from "express";
import { pool as defaultPool } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireAuth } from "./auth";
import { blockWhileImpersonating } from "../middleware/impersonation";
import { hit, perUserRateLimit, type HitFn } from "../middleware/rateLimit";
import { notifySuperAdmins } from "../lib/notify";
import { logPaymentEvent } from "../lib/paymentEvents";
import { PaymentRequestError, type PoolLike } from "../lib/paymentRequests";
import { listActivePlatformChannels, TOPUP_MAX_TOMAN, TOPUP_MIN_TOMAN, TOPUP_PRESETS_TOMAN } from "../lib/platformWallet";
import { cancelSchoolTopup, createSchoolTopup, getSchoolTopup, listSchoolTopups, submitSchoolReceipt } from "../lib/schoolWalletTopup";
import { canAccessSchool, SCHOOL_ADMIN_ONLY } from "../lib/schoolAuth";
import { logSchoolAudit } from "../lib/schoolAuditLog";
import type { MatchAlerts } from "../lib/paymentAlerts";
import { defaultPaymentAlerts } from "./paymentSmsWebhook";
import { formatPlatformTopup } from "./walletTopup";

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

export interface SchoolWalletTopupDeps { pool?: PoolLike; hitFn?: HitFn; alerts?: MatchAlerts; notifyAdmins?: typeof notifySuperAdmins }

export function createSchoolWalletTopupRouter(deps: SchoolWalletTopupDeps = {}): Router {
  const router = Router();
  const pool = deps.pool ?? (defaultPool as unknown as PoolLike);
  const hitFn = deps.hitFn ?? hit;
  const alerts = deps.alerts ?? defaultPaymentAlerts(pool);
  const notifyAdmins = deps.notifyAdmins ?? notifySuperAdmins;
  const base = "/schools/:schoolId/wallet/topup";

  /** فقط مدیرِ همین مدرسه (یا سوپرادمین)؛ بقیه و مدارسِ دیگر ۴۰۳. */
  const adminOnly = async (req: any, res: any, next: any) => {
    try {
      const { ok } = await canAccessSchool(req.userId, req.params.schoolId, SCHOOL_ADMIN_ONLY);
      if (!ok) { res.status(403).json({ error: "Forbidden" }); return; }
      next();
    } catch (err) { fail(res, err, "School wallet topup auth error"); }
  };

  router.get(`${base}/config`, requireAuth, adminOnly, async (_req: any, res) => {
    try {
      const channels = await listActivePlatformChannels(pool);
      res.json({ enabled: channels.length > 0, channels, presets: TOPUP_PRESETS_TOMAN, min: TOPUP_MIN_TOMAN, max: TOPUP_MAX_TOMAN });
    } catch (err) { fail(res, err, "Get school topup config error"); }
  });

  router.get(base, requireAuth, adminOnly, async (req: any, res) => {
    try { res.json({ items: (await listSchoolTopups(pool, req.params.schoolId, 20)).map(formatPlatformTopup) }); }
    catch (err) { fail(res, err, "List school topups error"); }
  });

  router.post(`${base}/request`, requireAuth, blockWhileImpersonating, adminOnly,
    perUserRateLimit("school_wallet_topup_request", 20, 60 * 60 * 1000, hitFn), async (req: any, res) => {
      try {
        const channelId = typeof req.body?.channelId === "string" && req.body.channelId ? req.body.channelId : null;
        const { payment, existing } = await createSchoolTopup(pool, {
          schoolId: req.params.schoolId, userId: req.userId, amountToman: req.body?.amount, channelId, alerts,
        });
        if (!existing) {
          await logPaymentEvent(pool, {
            kind: "request_created", scope: "platform", channelId: payment.channel.id, requestId: payment.id,
            actor: `user:${req.userId}`, message: `درخواستِ شارژِ کیف‌پولِ مدرسه ${Math.round(payment.baseAmountRial / 10).toLocaleString("en-US")} تومان (${payment.status})`,
            data: { purpose: "school_wallet_topup", schoolId: req.params.schoolId, baseAmountRial: payment.baseAmountRial, finalAmountRial: payment.finalAmountRial, status: payment.status },
          });
          void logSchoolAudit(req.params.schoolId, req.userId, "wallet.topup_started", `${payment.baseAmountRial} rial (request ${payment.id})`);
        }
        res.status(existing ? 200 : 201).json({ ...formatPlatformTopup(payment), existing });
      } catch (err) { fail(res, err, "School topup request error"); }
    });

  router.get(`${base}/:id/status`, requireAuth, adminOnly, async (req: any, res) => {
    try {
      const v = await getSchoolTopup(pool, req.params.schoolId, String(req.params.id));
      if (!v) { res.status(404).json({ error: "سفارش پیدا نشد" }); return; }
      res.json(formatPlatformTopup(v));
    } catch (err) { fail(res, err, "Get school topup status error"); }
  });

  router.post(`${base}/:id/receipt`, requireAuth, blockWhileImpersonating, adminOnly,
    perUserRateLimit("school_wallet_topup_receipt", 20, 60 * 60 * 1000, hitFn), async (req: any, res) => {
      try {
        const v = await submitSchoolReceipt(pool, { schoolId: req.params.schoolId, requestId: String(req.params.id), receiptDataUrl: req.body?.receiptUrl, alerts });
        await logPaymentEvent(pool, {
          kind: "receipt_uploaded", scope: "platform", channelId: v.channel.id, requestId: v.id,
          actor: `user:${req.userId}`, message: "فیشِ شارژِ کیف‌پولِ مدرسه آپلود شد؛ منتظرِ تأییدِ خودکار یا بررسیِ ادمین", data: { status: v.status, purpose: "school_wallet_topup" },
        });
        if (v.status === "awaiting_review") {
          await notifyAdmins({
            type: "admin_topup_receipt", severity: "info", title: "فیشِ شارژِ کیف‌پولِ مدرسه در انتظارِ بررسی",
            message: `یک فیش برایِ شارژِ ${Math.round(v.baseAmountRial / 10).toLocaleString("fa-IR")} تومانِ کیف‌پولِ یک مدرسه ثبت شد. اگر پیامکِ بانک تا چند دقیقه نرسید، از «پنل مدیریت ← کارت‌به‌کارت خودکار» بررسی کنید.`,
            refId: v.id,
          }).catch((e) => logger.warn({ err: e }, "school topup receipt admin notification failed"));
        }
        res.json(formatPlatformTopup(v));
      } catch (err) { fail(res, err, "School topup receipt error"); }
    });

  router.post(`${base}/:id/cancel`, requireAuth, blockWhileImpersonating, adminOnly, async (req: any, res) => {
    try {
      const { payment } = await cancelSchoolTopup(pool, { schoolId: req.params.schoolId, requestId: String(req.params.id) });
      await logPaymentEvent(pool, {
        kind: "request_canceled", scope: "platform", channelId: payment.channel.id, requestId: payment.id,
        actor: `user:${req.userId}`, message: "مدیرِ مدرسه درخواستِ شارژ را لغو کرد",
      });
      res.json({ success: true });
    } catch (err) { fail(res, err, "Cancel school topup error"); }
  });

  return router;
}

export default createSchoolWalletTopupRouter();
