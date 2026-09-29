/**
 * lib/paymentSweeper.ts — جاب پس‌زمینه‌ی ماژولِ کارت‌به‌کارت (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۹).
 *
 * هر دقیقه (روی همان الگوی `setInterval` بقیه‌ی جاب‌های این کدبیس؛ زیرساختِ cron جدید لازم نیست):
 *  ۱. `pending`/`queued`ِ سررسیدشده → `expired` و ارتقایِ صفِ همان کانال (`expireDueRequests`)؛
 *  ۲. پیامک‌های `ignored`ِ قدیمی‌تر از ۳۰ روز پاک (فرستنده‌ی غیرمجاز/برداشت — هیچ‌وقت match نمی‌شوند)؛
 *  ۳. رویدادهای لاگِ قدیمی‌تر از ۹۰ روز پاک؛
 *  ۴. هشدارِ «فیش بیش از N ساعت منتظرِ ادمین است» (`awaiting_review` عمداً خودکار منقضی نمی‌شود — پولِ
 *     احتمالاً واریزشده است؛ فقط هشدار می‌دهیم، یک‌بار برایِ هر درخواست)؛
 *  ۵. هشدارِ «گوشیِ فروشنده/پلتفرم ساکت است» (کانالِ فعال، ترافیکِ اخیر، ولی هیچ پیامکِ احرازشده‌ای برایِ
 *     بیش از `SMS_STALE_HOURS` ساعت) — به صاحبِ بات (یا سوپرادمین برایِ platform)، حداکثر هر ۱۲ ساعت؛
 *  ۶. هشدارِ «اثرِ تأییدِ باتِ فروشنده گیر کرده» (claim شده ولی done نشده بیش از ۱۵ دقیقه) — هرگز خودکار retry نمی‌شود
 *     (خطرِ اعمالِ دوباره‌ی اثرِ مالی)، فقط به انسان خبر می‌دهد.
 *
 * چندنمونه‌ای امن است: یک advisory lockِ سطحِ session اجازه می‌دهد فقط یک پروسه هم‌زمان جاروب کند (و همه‌ی
 * مراحل idempotent‌اند). خطای هر مرحله مرحله‌های بعدی را متوقف نمی‌کند.
 */
import { logger } from "./logger";
import { expireDueRequests, type PoolLike } from "./paymentRequests";
import { fanOut, type AlertNotifiers } from "./paymentAlerts";
import { lastEventAt, logPaymentEvent, purgeOldEvents } from "./paymentEvents";
import { SMS_STALE_HOURS } from "./paymentChannelAdmin";

export const IGNORED_SMS_RETENTION_DAYS = 30;
export const STALE_REVIEW_HOURS = 6;
export const STUCK_EFFECT_MINUTES = 15;
export const SILENT_ALERT_INTERVAL_HOURS = 12;
export const SWEEP_INTERVAL_MS = 60_000;
const MAX_EVENTS_PER_SWEEP = 200;
const LOCK_KEY = "payment_sweeper";
const HOUR = 3_600_000;

export interface SweepReport {
  at: Date;
  skipped?: "lock_held";
  expired: number;
  promoted: number;
  purgedIgnoredSms: number;
  purgedEvents: number;
  staleReviewAlerts: number;
  silentPhoneAlerts: number;
  stuckEffectAlerts: number;
  errors: string[];
}

const emptyReport = (at: Date): SweepReport => ({
  at, expired: 0, promoted: 0, purgedIgnoredSms: 0, purgedEvents: 0,
  staleReviewAlerts: 0, silentPhoneAlerts: 0, stuckEffectAlerts: 0, errors: [],
});

let last: SweepReport | null = null;
export const getLastSweepReport = (): SweepReport | null => last;

export interface SweepDeps {
  now?: Date;
  /** اعلان‌ها؛ بدونِ آن فقط رویداد ثبت می‌شود (تست). */
  notifiers?: AlertNotifiers;
}

async function q<T = any>(pool: PoolLike, sql: string, params: unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
  const c = await pool.connect();
  try {
    const r = await c.query(sql, params);
    return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
  } finally {
    c.release();
  }
}

/** یک دورِ جاروب. هرگز throw نمی‌کند (خطاها در `report.errors`). */
export async function sweepPaymentRequests(pool: PoolLike, deps: SweepDeps = {}): Promise<SweepReport> {
  const now = deps.now ?? new Date();
  const report = emptyReport(now);

  // فقط یک نمونه در لحظه (lockِ session روی یک اتصالِ اختصاصی).
  const lockConn = await pool.connect();
  let locked = false;
  try {
    const { rows } = await lockConn.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok", [LOCK_KEY]);
    locked = rows[0]?.ok === true;
    if (!locked) {
      report.skipped = "lock_held";
      return report;
    }
    await runSteps(pool, now, deps, report);
  } catch (err) {
    report.errors.push(`sweep: ${(err as Error).message}`);
    logger.error({ err }, "payment sweeper failed");
  } finally {
    if (locked) {
      try { await lockConn.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [LOCK_KEY]); } catch { /* اتصال افتاد: lock با بسته‌شدنِ session آزاد می‌شود */ }
    }
    lockConn.release();
  }

  if (!report.skipped) last = report;
  return report;
}

async function step(report: SweepReport, name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    report.errors.push(`${name}: ${(err as Error).message}`);
    logger.error({ err, step: name }, "payment sweeper step failed");
  }
}

async function runSteps(pool: PoolLike, now: Date, deps: SweepDeps, report: SweepReport): Promise<void> {
  const n = deps.notifiers ?? {};

  await step(report, "expire", async () => {
    const { expired, promoted } = await expireDueRequests(pool, { now });
    report.expired = expired.length;
    report.promoted = promoted.length;
    for (const r of expired.slice(0, MAX_EVENTS_PER_SWEEP)) {
      await logPaymentEvent(pool, {
        at: now,
        kind: "request_expired", scope: r.scope, botId: r.botId, channelId: r.channelId, requestId: r.id, actor: "system",
        message: r.status === "expired" ? "مهلتِ درخواست تمام شد" : "درخواست منقضی شد",
        data: { finalAmountRial: r.finalAmountRial, purpose: r.purpose },
      });
    }
    for (const p of promoted.slice(0, MAX_EVENTS_PER_SWEEP)) {
      await logPaymentEvent(pool, {
        at: now,
        kind: "queue_promoted", scope: p.scope, botId: p.botId, channelId: p.channelId, requestId: p.id, actor: "system",
        message: "نوبتِ صف رسید و درخواست pending شد", data: { finalAmountRial: p.finalAmountRial },
      });
    }
  });

  await step(report, "purge_ignored_sms", async () => {
    const cutoff = new Date(now.getTime() - IGNORED_SMS_RETENTION_DAYS * 24 * HOUR);
    const r = await q(pool, "DELETE FROM sms_inbox WHERE status = 'ignored' AND ingested_at < $1", [cutoff]);
    report.purgedIgnoredSms = r.rowCount;
  });

  await step(report, "purge_events", async () => {
    report.purgedEvents = await purgeOldEvents(pool, now);
  });

  await step(report, "stale_review", async () => {
    const { rows } = await q(pool,
      `SELECT r.id, r.scope, r.bot_id, r.channel_id, r.final_amount_rial, r.receipt_uploaded_at
         FROM payment_requests r
        WHERE r.status = 'awaiting_review' AND r.receipt_uploaded_at < $1
          AND NOT EXISTS (SELECT 1 FROM payment_events e WHERE e.kind = 'stale_review_alert' AND e.request_id = r.id)
        ORDER BY r.receipt_uploaded_at LIMIT 50`,
      [new Date(now.getTime() - STALE_REVIEW_HOURS * HOUR)]);
    for (const r of rows) {
      await logPaymentEvent(pool, {
        at: now,
        level: "warn", kind: "stale_review_alert", scope: r.scope, botId: r.bot_id, channelId: r.channel_id,
        requestId: r.id, actor: "system", message: `فیش بیش از ${STALE_REVIEW_HOURS} ساعت منتظرِ بررسی است`,
      });
      await fanOut(n, r.bot_id, {
        severity: "warning", type: "payment_review_stale", title: "فیشِ پرداخت هنوز بررسی نشده",
        message: `یک فیش (${Number(r.final_amount_rial).toLocaleString("en-US")} ریال) بیش از ${STALE_REVIEW_HOURS} ساعت است که منتظرِ تأیید/ردِ ادمین است.`,
        scope: r.scope, botId: r.bot_id, dedupeKey: `payment_review_stale:${r.id}`, refId: r.id,
      });
      report.staleReviewAlerts++;
    }
  });

  await step(report, "silent_phone", async () => {
    const { rows } = await q(pool,
      `SELECT c.id, c.scope, c.bot_id, c.last_sms_at
         FROM payment_channels c
        WHERE c.active AND (c.last_sms_at IS NULL OR c.last_sms_at < $1)
          AND EXISTS (SELECT 1 FROM payment_requests r WHERE r.channel_id = c.id
                       AND (r.status IN ('pending', 'awaiting_review', 'queued') OR r.created_at > $2))
        LIMIT 100`,
      [new Date(now.getTime() - SMS_STALE_HOURS * HOUR), new Date(now.getTime() - 24 * HOUR)]);
    for (const c of rows) {
      const prev = await lastEventAt(pool, "phone_silent_alert", c.id);
      if (prev && now.getTime() - new Date(prev).getTime() < SILENT_ALERT_INTERVAL_HOURS * HOUR) continue;
      await logPaymentEvent(pool, {
        at: now,
        level: "warn", kind: "phone_silent_alert", scope: c.scope, botId: c.bot_id, channelId: c.id, actor: "system",
        message: c.last_sms_at ? `بیش از ${SMS_STALE_HOURS} ساعت پیامکی از گوشی نرسیده` : "هنوز هیچ پیامکی از گوشی نرسیده",
        data: { lastSmsAt: c.last_sms_at },
      });
      await fanOut(n, c.bot_id, {
        severity: "warning", type: "payment_phone_silent", title: "گوشیِ دریافت‌کننده متصل نیست؟",
        message: `از کانالِ پرداخت ${c.last_sms_at ? `بیش از ${SMS_STALE_HOURS} ساعت` : "تا امروز"} پیامکِ بانک نرسیده ولی مشتری‌ها درخواستِ پرداخت داشته‌اند. اینترنت و برنامه‌ی ارسالِ پیامک (MacroDroid/SMS Forwarder) گوشی را بررسی کنید؛ تا آن موقع پرداخت‌ها با فیش و تأییدِ دستی انجام می‌شود.`,
        scope: c.scope, botId: c.bot_id, dedupeKey: `payment_phone_silent:${c.id}:${now.toISOString().slice(0, 13)}`, refId: c.id,
      });
      report.silentPhoneAlerts++;
    }
  });

  await step(report, "stuck_effect", async () => {
    const { rows } = await q(pool,
      `SELECT r.id, r.bot_id, r.channel_id, r.final_amount_rial, r.effect_claimed_at
         FROM payment_requests r
        WHERE r.scope = 'bot' AND r.status = 'confirmed' AND r.effect_claimed_at < $1 AND r.effect_done_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM payment_events e WHERE e.kind = 'effect_stuck_alert' AND e.request_id = r.id)
        LIMIT 50`,
      [new Date(now.getTime() - STUCK_EFFECT_MINUTES * 60_000)]);
    for (const r of rows) {
      await logPaymentEvent(pool, {
        at: now,
        level: "error", kind: "effect_stuck_alert", scope: "bot", botId: r.bot_id, channelId: r.channel_id, requestId: r.id,
        actor: "system", message: "اثرِ تأیید claim شد ولی بیش از ۱۵ دقیقه done نشد — retry خودکار نمی‌شود",
      });
      await fanOut(n, r.bot_id, {
        severity: "critical", type: "payment_effect_stuck", title: "اثرِ تأییدِ پرداخت کامل نشد",
        message: `پرداختِ ${Number(r.final_amount_rial).toLocaleString("en-US")} ریال تأیید شد ولی اعمالِ خودکارش (شارژ/تأییدِ سفارش) تمام نشد. برایِ جلوگیری از اعمالِ دوباره، خودکار تکرار نمی‌شود؛ دستی بررسی کنید.`,
        scope: "bot", botId: r.bot_id, dedupeKey: `payment_effect_stuck:${r.id}`, refId: r.id,
      });
      report.stuckEffectAlerts++;
    }
  });

  const did = report.expired + report.promoted + report.purgedIgnoredSms + report.purgedEvents +
    report.staleReviewAlerts + report.silentPhoneAlerts + report.stuckEffectAlerts + report.errors.length;
  if (did > 0) {
    await logPaymentEvent(pool, {
        at: now,
      level: report.errors.length ? "error" : "info", kind: "sweep", actor: "system",
      message: `sweeper: ${report.expired} منقضی، ${report.promoted} ارتقایِ صف، ${report.purgedIgnoredSms} پیامکِ ignored پاک`,
      data: { ...report, at: undefined, errors: report.errors.slice(0, 5) },
    });
  }
}

/** راه‌اندازیِ جاروبِ دوره‌ای. `stop()` را برمی‌گرداند (تست/shutdown). */
export function startPaymentSweeper(
  pool: PoolLike, notifiers: AlertNotifiers, opts: { intervalMs?: number } = {},
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await sweepPaymentRequests(pool, { notifiers });
      if (r.errors.length) logger.warn({ errors: r.errors }, "payment sweeper finished with errors");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, opts.intervalMs ?? SWEEP_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
