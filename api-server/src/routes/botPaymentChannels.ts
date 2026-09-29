/**
 * routes/botPaymentChannels.ts — تنظیماتِ «کارت‌به‌کارتِ خودکار» توسطِ فروشنده
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۷). زیرِ تبِ «پرداخت» تنظیماتِ بات در پنل وب.
 *
 *   GET    /bots/:botId/payment-channels                    فهرستِ کانال‌ها + سقف + سلامت
 *   POST   /bots/:botId/payment-channels                    ساختِ کانال (secret فقط همین‌جا یک‌بار)
 *   PATCH  /bots/:botId/payment-channels/:channelId         ویرایش (بدونِ لمسِ secret)
 *   POST   /bots/:botId/payment-channels/:channelId/rotate-secret   چرخشِ secret
 *   DELETE /bots/:botId/payment-channels/:channelId         حذف (فقط کانالِ بدونِ سابقه)
 *   POST   /bots/:botId/payment-channels/:channelId/test-sms        پیامکِ آزمایشیِ سمتِ سرور
 *   GET    /bots/:botId/payment-channels/:channelId/sms-log         آخرین پیامک‌های دریافتی
 *   GET    /card-autoconfirm-guide                          متنِ راهنما (همه‌ی واردشده‌ها)
 *   PUT    /admin/card-autoconfirm-guide                    ویرایشِ راهنما (فقط سوپرادمین)
 *
 * مالکیت: `resolveBotSheet` (مالک/مدیرِ بات/سوپرادمین) و **`botId` از خروجیِ آن** می‌آید نه از ورودی؛
 * کانالِ باتِ دیگر همیشه ۴۰۴ است. نوشتن‌ها زیرِ rate-limitِ per-user و ممنوع در حالتِ impersonation‌اند.
 * شماره‌کارت هرگز برگردانده نمی‌شود (فقط ماسک)؛ secret فقط هنگامِ ساخت/چرخش یک‌بار.
 */
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { pool as defaultPool } from "@workspace/db";
import { requireAuth, requireSuperAdmin } from "./auth.js";
import { blockWhileImpersonating } from "../middleware/impersonation.js";
import { perUserRateLimit, hit, type HitFn } from "../middleware/rateLimit.js";
import { resolveBotSheet, sendBotConfigError } from "../lib/botConfig.js";
import { writeAudit } from "../lib/audit.js";
import { logger } from "../lib/logger.js";
import { getCardAutoConfirmGuide, setCardAutoConfirmGuide } from "../lib/platformSettings.js";
import { getPaymentChannelLimits } from "../lib/paymentProGate.js";
import {
  ChannelAdminError, SMS_STALE_HOURS, createChannel, deleteChannel, getChannel, listChannels,
  listSmsLog, rotateSecret, runTestSms, updateChannel, validateNewChannel,
} from "../lib/paymentChannelAdmin.js";
import type { PoolLike } from "../lib/paymentRequests.js";

export interface BotPaymentChannelsDeps {
  pool?: PoolLike;
  auth?: (req: any, res: Response, next: NextFunction) => void;
  superAdmin?: (req: any, res: Response, next: NextFunction) => void;
  resolveBot?: (userId: string, botId: string) => Promise<{ botId: string }>;
  hitFn?: HitFn;
  audit?: typeof writeAudit;
  guide?: { get: typeof getCardAutoConfirmGuide; set: typeof setCardAutoConfirmGuide };
}

const WRITES_PER_HOUR = 60;
const HOUR = 3_600_000;

export function createBotPaymentChannelsRouter(deps: BotPaymentChannelsDeps = {}): Router {
  const pool = deps.pool ?? (defaultPool as unknown as PoolLike);
  const auth = deps.auth ?? requireAuth;
  const superAdmin = deps.superAdmin ?? requireSuperAdmin;
  const resolveBot = deps.resolveBot ?? (async (userId: string, botId: string) => {
    const r = await resolveBotSheet(userId, botId);
    return { botId: r.botId };
  });
  const hitFn = deps.hitFn ?? hit;
  const audit = deps.audit ?? writeAudit;
  const guide = deps.guide ?? { get: getCardAutoConfirmGuide, set: setCardAutoConfirmGuide };
  const writeLimit = perUserRateLimit("payment-channel-write", WRITES_PER_HOUR, HOUR, hitFn);
  const router = Router();

  function fail(res: Response, err: unknown, fallback: string): void {
    if (err instanceof ChannelAdminError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    sendBotConfigError(res, err, fallback);
  }

  router.get("/bots/:botId/payment-channels", auth, async (req: any, res) => {
    try {
      const { botId } = await resolveBot(req.userId, req.params.botId);
      const [channels, limits] = await Promise.all([listChannels(pool, botId), getPaymentChannelLimits(botId)]);
      res.json({
        channels,
        limits,
        staleHours: SMS_STALE_HOURS,
        publicUrlConfigured: Boolean((process.env.PUBLIC_SITE_URL ?? "").trim()),
      });
    } catch (err) {
      fail(res, err, "Failed to list payment channels");
    }
  });

  router.post("/bots/:botId/payment-channels", auth, blockWhileImpersonating, writeLimit, async (req: any, res) => {
    try {
      const { botId } = await resolveBot(req.userId, req.params.botId);
      const fields = validateNewChannel(req.body ?? {});
      const limits = await getPaymentChannelLimits(botId);
      const { channel, smsSecret } = await createChannel(pool, { botId, fields, maxChannels: limits.maxChannels });
      await audit({
        actorUserId: req.userId, action: "payment_channel_created",
        metadata: { botId, channelId: channel.id, kind: channel.kind },
      });
      logger.info({ botId, channelId: channel.id, kind: channel.kind }, "payment channel created");
      res.status(201).json({ channel, smsSecret });
    } catch (err) {
      fail(res, err, "Failed to create payment channel");
    }
  });

  router.patch("/bots/:botId/payment-channels/:channelId", auth, blockWhileImpersonating, writeLimit, async (req: any, res) => {
    try {
      const { botId } = await resolveBot(req.userId, req.params.botId);
      const channel = await updateChannel(pool, { botId, channelId: String(req.params.channelId), patch: req.body ?? {} });
      await audit({
        actorUserId: req.userId, action: "payment_channel_updated",
        metadata: { botId, channelId: channel.id, fields: Object.keys(req.body ?? {}).slice(0, 12) },
      });
      res.json({ channel });
    } catch (err) {
      fail(res, err, "Failed to update payment channel");
    }
  });

  router.post("/bots/:botId/payment-channels/:channelId/rotate-secret", auth, blockWhileImpersonating, writeLimit, async (req: any, res) => {
    try {
      const { botId } = await resolveBot(req.userId, req.params.botId);
      const channelId = String(req.params.channelId);
      const { smsSecret } = await rotateSecret(pool, { botId, channelId });
      await audit({ actorUserId: req.userId, action: "payment_channel_secret_rotated", metadata: { botId, channelId } });
      logger.info({ botId, channelId }, "payment channel secret rotated");
      res.json({ smsSecret, channel: await getChannel(pool, botId, channelId) });
    } catch (err) {
      fail(res, err, "Failed to rotate secret");
    }
  });

  router.delete("/bots/:botId/payment-channels/:channelId", auth, blockWhileImpersonating, writeLimit, async (req: any, res) => {
    try {
      const { botId } = await resolveBot(req.userId, req.params.botId);
      const channelId = String(req.params.channelId);
      await deleteChannel(pool, { botId, channelId });
      await audit({ actorUserId: req.userId, action: "payment_channel_deleted", metadata: { botId, channelId } });
      res.json({ ok: true });
    } catch (err) {
      fail(res, err, "Failed to delete payment channel");
    }
  });

  router.post("/bots/:botId/payment-channels/:channelId/test-sms", auth, blockWhileImpersonating, writeLimit, async (req: any, res) => {
    try {
      const { botId } = await resolveBot(req.userId, req.params.botId);
      const result = await runTestSms(pool, { botId, channelId: String(req.params.channelId) });
      res.json({ result });
    } catch (err) {
      fail(res, err, "Failed to run the SMS test");
    }
  });

  router.get("/bots/:botId/payment-channels/:channelId/sms-log", auth, async (req: any, res) => {
    try {
      const { botId } = await resolveBot(req.userId, req.params.botId);
      const limit = Number(req.query.limit);
      const entries = await listSmsLog(pool, {
        botId, channelId: String(req.params.channelId), limit: Number.isInteger(limit) && limit > 0 ? limit : 20,
      });
      const channel = await getChannel(pool, botId, String(req.params.channelId));
      res.json({ entries, health: channel.health, staleHours: SMS_STALE_HOURS });
    } catch (err) {
      fail(res, err, "Failed to read the SMS log");
    }
  });

  // ─── راهنما ────────────────────────────────────────────────────────────────

  router.get("/card-autoconfirm-guide", auth, async (_req: Request, res: Response) => {
    try {
      res.json(await guide.get());
    } catch (err) {
      logger.error({ err }, "Get card auto-confirm guide error");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.put("/admin/card-autoconfirm-guide", superAdmin, blockWhileImpersonating, async (req: any, res) => {
    try {
      const saved = await guide.set(req.body, req.userId);
      logger.info({ userId: req.userId }, "card auto-confirm guide updated");
      res.json(saved);
    } catch (err) {
      logger.error({ err }, "Update card auto-confirm guide error");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}

export default createBotPaymentChannelsRouter();
