/**
 * routes/adminCardAutoConfirm.ts — «کارت‌به‌کارت خودکار» در پنلِ مدیریت (فقط سوپرادمین)
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۸/۹).
 *
 *   GET    /admin/card-autoconfirm/overview                       آمارِ زنده + مواردِ نیازمندِ توجه
 *   GET    /admin/card-autoconfirm/channels                       همه‌ی کانال‌ها (پلتفرم + همه‌ی بات‌ها) + سلامتِ گوشی
 *   POST   /admin/card-autoconfirm/channels/:id/active            خاموش/روشنِ اضطراریِ هر کانال
 *   GET|POST /admin/card-autoconfirm/platform-channels            کانال‌های خودِ IrForge (شارژِ کیف‌پولِ سایت)
 *   PATCH|DELETE /admin/card-autoconfirm/platform-channels/:id
 *   POST   /admin/card-autoconfirm/platform-channels/:id/{rotate-secret,test-sms}
 *   GET    /admin/card-autoconfirm/platform-channels/:id/sms-log
 *   GET    /admin/card-autoconfirm/requests[/:id[/receipt]]       درخواست‌های پرداخت (همه‌ی scopeها)
 *   POST   /admin/card-autoconfirm/requests/:id/decide            تأیید/ردِ دستی (اولین تصمیم برنده)
 *   GET    /admin/card-autoconfirm/sms                            صندوقِ پیامک (متنِ ماسک‌شده)
 *   POST   /admin/card-autoconfirm/sms/:id/assign                 تخصیصِ دستیِ پیامک به درخواست (حلِ ابهام)
 *   GET    /admin/card-autoconfirm/events                         لاگِ تفصیلی (بدونِ متنِ خامِ پیامک/شماره‌کارت)
 *   POST   /admin/card-autoconfirm/sweep                          اجرای فوریِ sweeper
 *   POST   /admin/card-autoconfirm/migration/run                  اجرا/dry-runِ مهاجرتِ شارژِ قدیمی + گزارش
 *
 * همه‌ی نوشتن‌ها: rate-limitِ per-user، ممنوع در impersonation، ممیزی (audit). هیچ مسیرِ تأییدِ تازه‌ای اینجا ساخته نشده —
 * تأیید همان `decideRequestByAdmin` / `assignSmsToRequest` است (effect داخلِ تراکنش، اولین تصمیم برنده).
 */
import { Router } from "express";
import type { Response, NextFunction } from "express";
import { pool as defaultPool } from "@workspace/db";
import { requireSuperAdmin } from "./auth.js";
import { blockWhileImpersonating } from "../middleware/impersonation.js";
import { hit, perUserRateLimit, type HitFn } from "../middleware/rateLimit.js";
import { writeAudit } from "../lib/audit.js";
import { logger } from "../lib/logger.js";
import {
  ChannelAdminError, PLATFORM_MAX_CHANNELS, PLATFORM_OWNER, createChannel, deleteChannel, getChannel, listChannels, listSmsLog,
  rotateSecret, runTestSms, updateChannel, validateNewChannel, SMS_STALE_HOURS,
} from "../lib/paymentChannelAdmin.js";
import {
  assignSmsToRequest, getAdminRequestDetail, getOverview, getReceipt, listAdminChannels, listAdminRequests, listAdminSms,
  setChannelActiveByAdmin,
} from "../lib/paymentAdmin.js";
import { listPaymentEvents, logPaymentEvent, type EventLevel } from "../lib/paymentEvents.js";
import { decideRequestByAdmin } from "../lib/paymentDecisions.js";
import { PaymentRequestError, type PoolLike } from "../lib/paymentRequests.js";
import { sweepPaymentRequests } from "../lib/paymentSweeper.js";
import { formatMigrationReport, migrateLegacyWalletTopups } from "../lib/walletTopupMigration.js";
import type { AlertNotifiers, MatchAlerts } from "../lib/paymentAlerts.js";
import { createPaymentAlerts } from "../lib/paymentAlerts.js";
import { defaultPaymentNotifiers } from "./paymentSmsWebhook.js";

export interface AdminCardAutoConfirmDeps {
  pool?: PoolLike;
  superAdmin?: (req: any, res: Response, next: NextFunction) => void;
  hitFn?: HitFn;
  audit?: typeof writeAudit;
  notifiers?: AlertNotifiers;
}

const HTTP_BY_CODE: Record<string, number> = {
  not_found: 404, channel_not_found: 404, wrong_state: 409, sms_not_assignable: 409, amount_mismatch: 409,
  channel_mismatch: 409, no_effect: 409, invalid_admin: 400,
};
const WRITES_PER_HOUR = 200;
const HOUR = 3_600_000;
const str = (v: unknown, max = 100) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const scopeOf = (v: unknown): "platform" | "bot" | undefined => (v === "platform" || v === "bot" ? v : undefined);
const dateOf = (v: unknown): Date | undefined => {
  const d = typeof v === "string" && v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : undefined;
};

export function createAdminCardAutoConfirmRouter(deps: AdminCardAutoConfirmDeps = {}): Router {
  const pool = deps.pool ?? (defaultPool as unknown as PoolLike);
  const superAdmin = deps.superAdmin ?? requireSuperAdmin;
  const hitFn = deps.hitFn ?? hit;
  const audit = deps.audit ?? writeAudit;
  const notifiers = deps.notifiers ?? defaultPaymentNotifiers(pool);
  const alerts: MatchAlerts = createPaymentAlerts(notifiers);
  const writeLimit = perUserRateLimit("card-autoconfirm-admin-write", WRITES_PER_HOUR, HOUR, hitFn);
  const router = Router();
  const base = "/admin/card-autoconfirm";

  function fail(res: Response, err: unknown, fallback: string): void {
    if (err instanceof ChannelAdminError) { res.status(err.status).json({ error: err.message, code: err.code }); return; }
    if (err instanceof PaymentRequestError) { res.status(HTTP_BY_CODE[err.code] ?? 400).json({ error: err.message, code: err.code }); return; }
    logger.error({ err }, fallback);
    res.status(500).json({ error: "Internal server error" });
  }
  const get = (path: string, h: (req: any, res: Response) => Promise<void>, msg: string) =>
    router.get(`${base}${path}`, superAdmin, async (req: any, res) => { try { await h(req, res); } catch (e) { fail(res, e, msg); } });
  const write = (method: "post" | "patch" | "delete", path: string, h: (req: any, res: Response) => Promise<void>, msg: string) =>
    router[method](`${base}${path}`, superAdmin, blockWhileImpersonating, writeLimit, async (req: any, res: Response) => {
      try { await h(req, res); } catch (e) { fail(res, e, msg); }
    });

  // ─── نمای کلی / کانال‌ها ─────────────────────────────────────────────────
  get("/overview", async (_req, res) => { res.json(await getOverview(pool)); }, "card-autoconfirm overview");

  get("/channels", async (req, res) => {
    res.json({
      channels: await listAdminChannels(pool, {
        scope: scopeOf(req.query.scope), q: str(req.query.q, 60) || undefined, onlySilent: req.query.silent === "1", limit: Number(req.query.limit) || undefined,
      }),
      staleHours: SMS_STALE_HOURS,
    });
  }, "card-autoconfirm channels");

  write("post", "/channels/:id/active", async (req, res) => {
    if (typeof req.body?.active !== "boolean") { res.status(400).json({ error: "active باید true/false باشد", code: "invalid_active" }); return; }
    const out = await setChannelActiveByAdmin(pool, {
      channelId: String(req.params.id), active: req.body.active, adminId: req.userId, reason: str(req.body?.reason, 200),
    });
    await audit({ actorUserId: req.userId, action: "card_autoconfirm_channel_active", metadata: { channelId: out.id, active: out.active, scope: out.scope, botId: out.botId } });
    res.json(out);
  }, "card-autoconfirm channel active");

  // ─── کانال‌های پلتفرم ────────────────────────────────────────────────────
  get("/platform-channels", async (_req, res) => {
    res.json({
      channels: await listChannels(pool, PLATFORM_OWNER), maxChannels: PLATFORM_MAX_CHANNELS,
      // همان شکلِ پاسخِ پنلِ فروشنده (`limits`) تا یک کامپوننتِ UI برایِ هر دو کار کند.
      limits: { maxChannels: PLATFORM_MAX_CHANNELS, pro: false }, staleHours: SMS_STALE_HOURS,
      publicUrlConfigured: Boolean((process.env.PUBLIC_SITE_URL ?? "").trim()),
      legacyWebhookEnabled: Boolean((process.env.SMS_WEBHOOK_SECRET ?? "").trim()),
    });
  }, "card-autoconfirm platform channels");

  write("post", "/platform-channels", async (req, res) => {
    const fields = validateNewChannel(req.body ?? {});
    const { channel, smsSecret } = await createChannel(pool, { owner: PLATFORM_OWNER, fields, maxChannels: PLATFORM_MAX_CHANNELS });
    await audit({ actorUserId: req.userId, action: "payment_channel_created", metadata: { scope: "platform", channelId: channel.id, kind: channel.kind } });
    await logPaymentEvent(pool, { kind: "channel_created", scope: "platform", channelId: channel.id, actor: `admin:${req.userId}`, message: "کانالِ پلتفرم ساخته شد" });
    res.status(201).json({ channel, smsSecret });
  }, "card-autoconfirm create platform channel");

  write("patch", "/platform-channels/:id", async (req, res) => {
    const channel = await updateChannel(pool, { owner: PLATFORM_OWNER, channelId: String(req.params.id), patch: req.body ?? {} });
    await audit({ actorUserId: req.userId, action: "payment_channel_updated", metadata: { scope: "platform", channelId: channel.id, fields: Object.keys(req.body ?? {}).slice(0, 12) } });
    await logPaymentEvent(pool, { kind: "channel_updated", scope: "platform", channelId: channel.id, actor: `admin:${req.userId}`, message: "کانالِ پلتفرم ویرایش شد", data: { fields: Object.keys(req.body ?? {}).slice(0, 12) } });
    res.json({ channel });
  }, "card-autoconfirm update platform channel");

  write("post", "/platform-channels/:id/rotate-secret", async (req, res) => {
    const channelId = String(req.params.id);
    const { smsSecret } = await rotateSecret(pool, { owner: PLATFORM_OWNER, channelId });
    await audit({ actorUserId: req.userId, action: "payment_channel_secret_rotated", metadata: { scope: "platform", channelId } });
    await logPaymentEvent(pool, { level: "warn", kind: "channel_secret_rotated", scope: "platform", channelId, actor: `admin:${req.userId}`, message: "کلیدِ وبهوکِ کانالِ پلتفرم چرخانده شد (کلیدِ قبلی از کار افتاد)" });
    res.json({ smsSecret, channel: await getChannel(pool, PLATFORM_OWNER, channelId) });
  }, "card-autoconfirm rotate platform secret");

  write("delete", "/platform-channels/:id", async (req, res) => {
    const channelId = String(req.params.id);
    await deleteChannel(pool, { owner: PLATFORM_OWNER, channelId });
    await audit({ actorUserId: req.userId, action: "payment_channel_deleted", metadata: { scope: "platform", channelId } });
    res.json({ ok: true });
  }, "card-autoconfirm delete platform channel");

  write("post", "/platform-channels/:id/test-sms", async (req, res) => {
    res.json({ result: await runTestSms(pool, { owner: PLATFORM_OWNER, channelId: String(req.params.id) }) });
  }, "card-autoconfirm platform test sms");

  get("/platform-channels/:id/sms-log", async (req, res) => {
    const limit = Number(req.query.limit);
    const channelId = String(req.params.id);
    const entries = await listSmsLog(pool, { owner: PLATFORM_OWNER, channelId, limit: Number.isInteger(limit) && limit > 0 ? limit : 20 });
    res.json({ entries, health: (await getChannel(pool, PLATFORM_OWNER, channelId)).health, staleHours: SMS_STALE_HOURS });
  }, "card-autoconfirm platform sms log");

  // ─── درخواست‌ها ──────────────────────────────────────────────────────────
  get("/requests", async (req, res) => {
    res.json({
      requests: await listAdminRequests(pool, {
        scope: scopeOf(req.query.scope), status: str(req.query.status, 20) || undefined, botId: str(req.query.botId, 64) || undefined,
        channelId: str(req.query.channelId, 64) || undefined, q: str(req.query.q, 60) || undefined, before: dateOf(req.query.before),
        limit: Number(req.query.limit) || undefined,
      }),
    });
  }, "card-autoconfirm requests");

  get("/requests/:id", async (req, res) => {
    const d = await getAdminRequestDetail(pool, String(req.params.id));
    if (!d) { res.status(404).json({ error: "درخواست پیدا نشد.", code: "not_found" }); return; }
    res.json(d);
  }, "card-autoconfirm request detail");

  get("/requests/:id/receipt", async (req, res) => { res.json(await getReceipt(pool, String(req.params.id))); }, "card-autoconfirm receipt");

  write("post", "/requests/:id/decide", async (req, res) => {
    const decision = req.body?.decision;
    if (decision !== "approve" && decision !== "reject") { res.status(400).json({ error: "decision باید approve یا reject باشد", code: "invalid_decision" }); return; }
    const out = await decideRequestByAdmin(pool, {
      requestId: String(req.params.id), decision, adminId: String(req.userId), reason: str(req.body?.reason, 500) || null,
    });
    if (out.decided) {
      await audit({ actorUserId: req.userId, action: "card_autoconfirm_decision", metadata: { requestId: out.request.id, decision, scope: out.request.scope, botId: out.request.botId } });
      if (decision === "approve") {
        await alerts.onConfirmed?.({ request: out.request, smsId: null, promoted: out.promoted });
      } else {
        await logPaymentEvent(pool, {
          kind: "rejected_by_admin", scope: out.request.scope, botId: out.request.botId, channelId: out.request.channelId, requestId: out.request.id,
          actor: `admin:${req.userId}`, message: `ردِ دستی${out.request.rejectReason ? ` — ${out.request.rejectReason.slice(0, 120)}` : ""}`,
        });
      }
    }
    res.json({ decided: out.decided, request: { id: out.request.id, status: out.request.status }, promoted: out.promoted.map((p) => p.id) });
  }, "card-autoconfirm decide");

  // ─── پیامک‌ها ────────────────────────────────────────────────────────────
  get("/sms", async (req, res) => {
    res.json({
      sms: await listAdminSms(pool, {
        scope: scopeOf(req.query.scope), channelId: str(req.query.channelId, 64) || undefined, status: str(req.query.status, 20) || undefined,
        before: dateOf(req.query.before), limit: Number(req.query.limit) || undefined,
      }),
    });
  }, "card-autoconfirm sms");

  write("post", "/sms/:id/assign", async (req, res) => {
    const requestId = str(req.body?.requestId, 64);
    if (!requestId) { res.status(400).json({ error: "requestId لازم است", code: "invalid_request_id" }); return; }
    const out = await assignSmsToRequest(pool, { smsId: String(req.params.id), requestId, adminId: String(req.userId) });
    await audit({ actorUserId: req.userId, action: "card_autoconfirm_sms_assigned", metadata: { smsId: String(req.params.id), requestId, scope: out.request.scope } });
    await alerts.onConfirmed?.({ request: out.request, smsId: String(req.params.id), promoted: out.promoted });
    res.json({ ok: true, request: { id: out.request.id, status: out.request.status } });
  }, "card-autoconfirm assign sms");

  // ─── لاگ / sweeper / مهاجرت ──────────────────────────────────────────────
  get("/events", async (req, res) => {
    const level = str(req.query.level, 10);
    res.json({
      events: await listPaymentEvents(pool, {
        level: level === "problems" ? "problems" : (["info", "warn", "error"].includes(level) ? (level as EventLevel) : undefined),
        kind: str(req.query.kind, 60) || undefined, scope: scopeOf(req.query.scope), botId: str(req.query.botId, 64) || undefined,
        channelId: str(req.query.channelId, 64) || undefined, requestId: str(req.query.requestId, 64) || undefined,
        before: dateOf(req.query.before), limit: Number(req.query.limit) || undefined,
      }),
    });
  }, "card-autoconfirm events");

  write("post", "/sweep", async (req, res) => {
    const report = await sweepPaymentRequests(pool, { notifiers });
    await audit({ actorUserId: req.userId, action: "card_autoconfirm_sweep", metadata: { expired: report.expired, promoted: report.promoted, skipped: report.skipped ?? null } });
    res.json({ report });
  }, "card-autoconfirm sweep");

  write("post", "/migration/run", async (req, res) => {
    const dryRun = req.body?.dryRun !== false;           // پیش‌فرض dry-run؛ اجرای واقعی باید صریح باشد
    const report = await migrateLegacyWalletTopups(pool, { dryRun });
    if (!dryRun) await audit({ actorUserId: req.userId, action: "card_autoconfirm_migration", metadata: { migrated: report.topups.migrated, sms: report.sms.migrated, ok: report.ok } });
    res.json({ report, markdown: formatMigrationReport(report) });
  }, "card-autoconfirm migration");

  return router;
}

export default createAdminCardAutoConfirmRouter();
