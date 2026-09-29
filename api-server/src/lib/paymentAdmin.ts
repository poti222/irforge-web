/**
 * lib/paymentAdmin.ts — دیدن و مدیریتِ ماژولِ کارت‌به‌کارت توسطِ سوپرادمین
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۹ + درخواستِ «قسمتِ مدیریتِ جداگانه»).
 *
 * همه‌ی توابع فقط برایِ سوپرادمین‌اند (route `requireSuperAdmin`) و **فقط می‌خوانند/مدیریت می‌کنند** — هیچ‌کدام مسیرِ
 * تأییدِ جدیدی نمی‌سازند: تأیید/رد همچنان از `decideRequestByAdmin` (اولین تصمیم برنده، effect داخلِ تراکنش) و تخصیصِ
 * دستیِ پیامک از `assignSmsToRequest` (همین فایل، با همان قفل‌ها و همان `confirmRequestTx`) می‌گذرد.
 *
 * حریم: شماره‌کارت فقط ماسک (`6037-****-****-1234`)؛ متنِ پیامک فقط با ماسکِ ارقامِ بلند؛ secret هرگز؛ فیشِ آپلودی فقط
 * از endpointِ جدا (`getReceipt`) و فقط برایِ سوپرادمین.
 */
import { decryptToken } from "./tokenCrypto";
import { maskCardNumber } from "./cardMask";
import { maskLongDigits, SMS_STALE_HOURS, webhookUrlFor, channelHealth } from "./paymentChannelAdmin";
import { confirmRequestTx } from "./paymentMatcher";
import { getPaymentEffect, type PaymentEffect } from "./paymentEffects";
import { logPaymentEvent, type PaymentEventRow } from "./paymentEvents";
import { promoteQueue, withChannelLock, mapRow, PaymentRequestError, type PaymentRequestRow, type PoolLike, type ClientLike } from "./paymentRequests";
import { STALE_REVIEW_HOURS, STUCK_EFFECT_MINUTES, getLastSweepReport, type SweepReport } from "./paymentSweeper";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const ADMIN_LIST_MAX = 200;

async function withClient<T>(pool: PoolLike, fn: (c: ClientLike) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { return await fn(c); } finally { c.release(); }
}

function safeCardMask(enc: string | null): string | null {
  if (!enc) return null;
  try { return maskCardNumber(decryptToken(enc)); } catch { return "****"; }
}
const toman = (rial: number | string | null) => (rial === null ? null : Math.round(Number(rial) / 10));
const clampLimit = (n: unknown, def = 50) => Math.min(Math.max(Math.trunc(Number(n) || def), 1), ADMIN_LIST_MAX);

// ─── نمای کلی ───────────────────────────────────────────────────────────────

export interface AdminOverview {
  generatedAt: Date;
  open: Record<"platform" | "bot", { queued: number; pending: number; awaitingReview: number }>;
  last24h: {
    created: number; confirmed: number; confirmedBySms: number; confirmedByAdmin: number;
    expired: number; rejected: number; canceled: number; confirmedAmountToman: number;
  };
  last7d: { created: number; confirmed: number; confirmedAmountToman: number };
  sms24h: { total: number; matched: number; unmatchedDeposits: number; ambiguous: number; ignored: number; other: number };
  channels: { total: number; active: number; platform: number; bot: number; silent: number };
  attention: { staleReviews: number; stuckEffects: number; ambiguousSms: number; unmatchedDepositsRecent: number; problemEvents24h: number };
  sweeper: SweepReport | null;
  legacyMigration: { at: Date; ok: boolean; message: string } | null;
}

export async function getOverview(pool: PoolLike, now = new Date()): Promise<AdminOverview> {
  const d1 = new Date(now.getTime() - DAY);
  const d7 = new Date(now.getTime() - 7 * DAY);
  return withClient(pool, async (c) => {
    const open = { platform: { queued: 0, pending: 0, awaitingReview: 0 }, bot: { queued: 0, pending: 0, awaitingReview: 0 } };
    const { rows: openRows } = await c.query(
      "SELECT scope, status, COUNT(*)::int AS n FROM payment_requests WHERE status IN ('queued','pending','awaiting_review') GROUP BY scope, status");
    for (const r of openRows) {
      const k = r.status === "awaiting_review" ? "awaitingReview" : r.status;
      (open as any)[r.scope][k] = r.n;
    }
    const { rows: [q24] } = await c.query(
      `SELECT COUNT(*)::int AS created,
              COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
              COUNT(*) FILTER (WHERE status = 'confirmed' AND confirmed_by = 'sms')::int AS by_sms,
              COUNT(*) FILTER (WHERE status = 'confirmed' AND confirmed_by = 'admin')::int AS by_admin,
              COUNT(*) FILTER (WHERE status = 'expired')::int AS expired,
              COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
              COUNT(*) FILTER (WHERE status = 'canceled')::int AS canceled,
              COALESCE(SUM(base_amount_rial) FILTER (WHERE status = 'confirmed'), 0) AS amount
         FROM payment_requests WHERE created_at >= $1`, [d1]);
    const { rows: [q7] } = await c.query(
      `SELECT COUNT(*)::int AS created, COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
              COALESCE(SUM(base_amount_rial) FILTER (WHERE status = 'confirmed'), 0) AS amount
         FROM payment_requests WHERE created_at >= $1`, [d7]);
    const { rows: [s24] } = await c.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'matched')::int AS matched,
              COUNT(*) FILTER (WHERE status = 'unmatched' AND parsed_ok AND direction = 'deposit')::int AS unmatched_dep,
              COUNT(*) FILTER (WHERE status = 'ambiguous')::int AS ambiguous,
              COUNT(*) FILTER (WHERE status = 'ignored')::int AS ignored
         FROM sms_inbox WHERE ingested_at >= $1`, [d1]);
    const { rows: [ch] } = await c.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE active)::int AS active,
              COUNT(*) FILTER (WHERE scope = 'platform')::int AS platform, COUNT(*) FILTER (WHERE scope = 'bot')::int AS bot,
              COUNT(*) FILTER (WHERE active AND (last_sms_at IS NULL OR last_sms_at < $1) AND EXISTS (
                SELECT 1 FROM payment_requests r WHERE r.channel_id = payment_channels.id
                   AND (r.status IN ('pending','awaiting_review','queued') OR r.created_at > $2)))::int AS silent
         FROM payment_channels`,
      [new Date(now.getTime() - SMS_STALE_HOURS * HOUR), d1]);
    const { rows: [att] } = await c.query(
      `SELECT
         (SELECT COUNT(*)::int FROM payment_requests WHERE status = 'awaiting_review' AND receipt_uploaded_at < $1) AS stale_reviews,
         (SELECT COUNT(*)::int FROM payment_requests WHERE scope = 'bot' AND status = 'confirmed' AND effect_claimed_at < $2 AND effect_done_at IS NULL) AS stuck,
         (SELECT COUNT(*)::int FROM sms_inbox WHERE status = 'ambiguous') AS amb,
         (SELECT COUNT(*)::int FROM sms_inbox WHERE status = 'unmatched' AND parsed_ok AND direction = 'deposit' AND ingested_at >= $3) AS unm,
         (SELECT COUNT(*)::int FROM payment_events WHERE level <> 'info' AND at >= $3) AS prob`,
      [new Date(now.getTime() - STALE_REVIEW_HOURS * HOUR), new Date(now.getTime() - STUCK_EFFECT_MINUTES * 60_000), d1]);
    const { rows: mig } = await c.query(
      "SELECT at, level, message FROM payment_events WHERE kind = 'legacy_migration' ORDER BY at DESC LIMIT 1");
    return {
      generatedAt: now,
      open: open as AdminOverview["open"],
      last24h: {
        created: q24.created, confirmed: q24.confirmed, confirmedBySms: q24.by_sms, confirmedByAdmin: q24.by_admin,
        expired: q24.expired, rejected: q24.rejected, canceled: q24.canceled, confirmedAmountToman: toman(q24.amount) ?? 0,
      },
      last7d: { created: q7.created, confirmed: q7.confirmed, confirmedAmountToman: toman(q7.amount) ?? 0 },
      sms24h: {
        total: s24.total, matched: s24.matched, unmatchedDeposits: s24.unmatched_dep, ambiguous: s24.ambiguous, ignored: s24.ignored,
        other: s24.total - s24.matched - s24.unmatched_dep - s24.ambiguous - s24.ignored,
      },
      channels: { total: ch.total, active: ch.active, platform: ch.platform, bot: ch.bot, silent: ch.silent },
      attention: {
        staleReviews: att.stale_reviews, stuckEffects: att.stuck, ambiguousSms: att.amb, unmatchedDepositsRecent: att.unm,
        problemEvents24h: att.prob,
      },
      sweeper: getLastSweepReport(),
      legacyMigration: mig[0] ? { at: mig[0].at, ok: mig[0].level === "info", message: mig[0].message } : null,
    };
  });
}

// ─── کانال‌ها (همه‌ی scopeها) ────────────────────────────────────────────────

export interface AdminChannelRow {
  id: string;
  scope: "platform" | "bot";
  botId: string | null;
  botName: string | null;
  ownerEmail: string | null;
  kind: string;
  cardMasked: string | null;
  holderName: string | null;
  bankName: string | null;
  paymentUrl: string | null;
  minAmountToman: number;
  bankParser: string;
  senderAllowlist: string[];
  active: boolean;
  lastSmsAt: Date | null;
  health: ReturnType<typeof channelHealth>;
  createdAt: Date;
  webhookUrl: string;
  counts: { open: number; confirmed: number; total: number; smsUnmatched: number };
}

export async function listAdminChannels(
  pool: PoolLike, f: { scope?: "platform" | "bot"; q?: string; onlySilent?: boolean; limit?: number } = {}, now = new Date(),
): Promise<AdminChannelRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.scope) { params.push(f.scope); where.push(`c.scope = $${params.length}`); }
  if (f.q) {
    params.push(`%${f.q.replace(/[%_\\]/g, "\\$&").slice(0, 60)}%`);
    where.push(`(b.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR c.holder_name ILIKE $${params.length} OR c.id ILIKE $${params.length})`);
  }
  params.push(clampLimit(f.limit, 100));
  const rows = await withClient(pool, async (c) => (await c.query(
    `SELECT c.*, b.name AS bot_name, u.email AS owner_email,
            (SELECT COUNT(*)::int FROM payment_requests r WHERE r.channel_id = c.id AND r.status IN ('queued','pending','awaiting_review')) AS open_n,
            (SELECT COUNT(*)::int FROM payment_requests r WHERE r.channel_id = c.id AND r.status = 'confirmed') AS confirmed_n,
            (SELECT COUNT(*)::int FROM payment_requests r WHERE r.channel_id = c.id) AS total_n,
            (SELECT COUNT(*)::int FROM sms_inbox s WHERE s.channel_id = c.id AND s.status IN ('unmatched','ambiguous') AND s.parsed_ok AND s.direction = 'deposit') AS sms_unm
       FROM payment_channels c
       LEFT JOIN bots b ON b.id = c.bot_id
       LEFT JOIN users u ON u.id = b.user_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY (c.scope = 'platform') DESC, c.created_at DESC, c.id LIMIT $${params.length}`, params)).rows);
  const out = rows.map((r): AdminChannelRow => ({
    id: r.id, scope: r.scope, botId: r.bot_id, botName: r.bot_name ?? null, ownerEmail: r.owner_email ?? null, kind: r.kind,
    cardMasked: safeCardMask(r.card_number_enc), holderName: r.holder_name, bankName: r.bank_name, paymentUrl: r.payment_url,
    minAmountToman: Math.round(Number(r.min_amount_rial) / 10), bankParser: r.bank_parser, senderAllowlist: r.sender_allowlist ?? [],
    active: r.active, lastSmsAt: r.last_sms_at, health: channelHealth(r.last_sms_at ?? null, now), createdAt: r.created_at,
    webhookUrl: webhookUrlFor(r.id),
    counts: { open: r.open_n, confirmed: r.confirmed_n, total: r.total_n, smsUnmatched: r.sms_unm },
  }));
  return f.onlySilent ? out.filter((c) => c.active && c.health.status !== "ok") : out;
}

/** خاموش/روشن‌کردنِ اضطراریِ هر کانال توسطِ سوپرادمین (حتی با درخواستِ فعال: درخواست‌های جاری ادامه می‌دهند، جدیدی ساخته نمی‌شود). */
export async function setChannelActiveByAdmin(
  pool: PoolLike, input: { channelId: string; active: boolean; adminId: string; reason?: string },
): Promise<{ id: string; active: boolean; scope: string; botId: string | null }> {
  const row = await withChannelLock(pool, input.channelId, async (c) => {
    const { rows } = await c.query(
      "UPDATE payment_channels SET active = $2 WHERE id = $1 RETURNING id, active, scope, bot_id", [input.channelId, input.active]);
    return rows[0] ?? null;
  });
  if (!row) throw new PaymentRequestError("کانال پیدا نشد.", "channel_not_found");
  await logPaymentEvent(pool, {
    level: "warn", kind: input.active ? "channel_enabled_by_admin" : "channel_disabled_by_admin", scope: row.scope, botId: row.bot_id,
    channelId: row.id, actor: `admin:${input.adminId}`,
    message: `کانال توسطِ سوپرادمین ${input.active ? "فعال" : "غیرفعال"} شد${input.reason ? ` — ${input.reason.slice(0, 120)}` : ""}`,
  });
  return { id: row.id, active: row.active, scope: row.scope, botId: row.bot_id };
}

// ─── درخواست‌ها ─────────────────────────────────────────────────────────────

export interface AdminRequestRow {
  id: string;
  scope: "platform" | "bot";
  botId: string | null;
  botName: string | null;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  purpose: string;
  orderId: string | null;
  status: string;
  baseAmountToman: number;
  suffixRial: number;
  finalAmountRial: number;
  channelId: string;
  channelKind: string;
  cardMasked: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  confirmedAt: Date | null;
  confirmedBy: string | null;
  confirmedByAdminId: string | null;
  rejectReason: string | null;
  hasReceipt: boolean;
  receiptUploadedAt: Date | null;
  effect: "none" | "pending" | "claimed" | "done";
  matchedSmsId: string | null;
  legacy: boolean;
}

const effectState = (r: any): AdminRequestRow["effect"] =>
  r.status !== "confirmed" ? "none" : r.effect_done_at ? "done" : r.effect_claimed_at ? "claimed" : "pending";

function mapAdminRequest(r: any): AdminRequestRow {
  return {
    id: r.id, scope: r.scope, botId: r.bot_id, botName: r.bot_name ?? null, userId: r.user_id,
    userName: r.user_name ?? null, userEmail: r.user_email ?? null, purpose: r.purpose, orderId: r.order_id, status: r.status,
    baseAmountToman: toman(r.base_amount_rial) ?? 0, suffixRial: Number(r.suffix_rial), finalAmountRial: Number(r.final_amount_rial),
    channelId: r.channel_id, channelKind: r.channel_kind, cardMasked: safeCardMask(r.card_number_enc ?? null),
    createdAt: r.created_at, expiresAt: r.expires_at, confirmedAt: r.confirmed_at, confirmedBy: r.confirmed_by,
    confirmedByAdminId: r.confirmed_by_admin_id, rejectReason: r.reject_reason, hasReceipt: Boolean(r.receipt_file_id),
    receiptUploadedAt: r.receipt_uploaded_at, effect: effectState(r), matchedSmsId: r.matched_sms_id, legacy: Boolean(r.legacy_ref),
  };
}

const REQUEST_SELECT = `
  SELECT r.id, r.scope, r.bot_id, r.user_id, r.purpose, r.order_id, r.status, r.base_amount_rial, r.suffix_rial, r.final_amount_rial,
         r.channel_id, r.channel_kind, r.created_at, r.expires_at, r.confirmed_at, r.confirmed_by, r.confirmed_by_admin_id,
         r.reject_reason, r.receipt_file_id, r.receipt_uploaded_at, r.effect_claimed_at, r.effect_done_at, r.matched_sms_id, r.legacy_ref,
         c.card_number_enc, b.name AS bot_name,
         CASE WHEN r.scope = 'platform' THEN pu.name END AS user_name, CASE WHEN r.scope = 'platform' THEN pu.email END AS user_email
    FROM payment_requests r
    JOIN payment_channels c ON c.id = r.channel_id
    LEFT JOIN bots b ON b.id = r.bot_id
    LEFT JOIN users pu ON pu.id = r.user_id AND r.scope = 'platform'`;

export interface RequestFilter {
  scope?: "platform" | "bot";
  status?: string;
  botId?: string;
  channelId?: string;
  q?: string;
  before?: Date;
  limit?: number;
}

const STATUSES = ["queued", "pending", "awaiting_review", "confirmed", "expired", "canceled", "rejected"];

export async function listAdminRequests(pool: PoolLike, f: RequestFilter = {}): Promise<AdminRequestRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
  if (f.scope) add("r.scope = ?", f.scope);
  if (f.status === "open") where.push("r.status IN ('queued','pending','awaiting_review')");
  else if (f.status && STATUSES.includes(f.status)) add("r.status = ?", f.status);
  if (f.botId) add("r.bot_id = ?", f.botId);
  if (f.channelId) add("r.channel_id = ?", f.channelId);
  if (f.before) add("r.created_at < ?", f.before);
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, "\\$&").slice(0, 60)}%`;
    params.push(like);
    const i = params.length;
    const conds = [`r.id ILIKE $${i}`, `r.user_id ILIKE $${i}`, `pu.email ILIKE $${i}`, `pu.name ILIKE $${i}`, `b.name ILIKE $${i}`, `r.order_id ILIKE $${i}`];
    // فقط‌ارقامِ بلند = جستجوی مبلغِ نهایی (ریال) — دقیقاً همان عددی که در پیامک/پرداخت است.
    if (/^\d{4,15}$/.test(f.q.trim())) {
      params.push(f.q.trim());
      conds.push(`r.final_amount_rial = $${params.length}::bigint`);
    }
    where.push(`(${conds.join(" OR ")})`);
  }
  params.push(clampLimit(f.limit));
  const rows = await withClient(pool, async (c) => (await c.query(
    `${REQUEST_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY r.created_at DESC, r.id DESC LIMIT $${params.length}`, params)).rows);
  return rows.map(mapAdminRequest);
}

export interface AdminSmsRow {
  id: string;
  channelId: string;
  scope: "platform" | "bot";
  botId: string | null;
  botName: string | null;
  receivedAt: Date;
  ingestedAt: Date;
  sender: string | null;
  direction: string;
  amountToman: number | null;
  amountRial: number | null;
  parsedOk: boolean;
  status: string;
  preview: string;
  isTest: boolean;
  matchedRequestId: string | null;
}

const mapSms = (r: any): AdminSmsRow => ({
  id: r.id, channelId: r.channel_id, scope: r.scope, botId: r.bot_id, botName: r.bot_name ?? null, receivedAt: r.received_at,
  ingestedAt: r.ingested_at, sender: r.sender, direction: r.direction, amountToman: r.amount_rial === null ? null : toman(r.amount_rial),
  amountRial: r.amount_rial === null ? null : Number(r.amount_rial), parsedOk: r.parsed_ok, status: r.status,
  preview: maskLongDigits(String(r.raw_text ?? "")).slice(0, 200), isTest: r.sender === "IRFORGE-TEST", matchedRequestId: r.matched_request_id,
});

const SMS_SELECT = `
  SELECT s.*, c.scope, c.bot_id, b.name AS bot_name
    FROM sms_inbox s JOIN payment_channels c ON c.id = s.channel_id LEFT JOIN bots b ON b.id = c.bot_id`;

export async function listAdminSms(
  pool: PoolLike, f: { scope?: "platform" | "bot"; channelId?: string; status?: string; before?: Date; limit?: number } = {},
): Promise<AdminSmsRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
  if (f.scope) add("c.scope = ?", f.scope);
  if (f.channelId) add("s.channel_id = ?", f.channelId);
  if (f.status === "attention") where.push("s.status IN ('unmatched','ambiguous') AND s.parsed_ok AND s.direction = 'deposit'");
  else if (f.status && ["unmatched", "matched", "ambiguous", "ignored"].includes(f.status)) add("s.status = ?", f.status);
  if (f.before) add("s.ingested_at < ?", f.before);
  params.push(clampLimit(f.limit));
  const rows = await withClient(pool, async (c) => (await c.query(
    `${SMS_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY s.ingested_at DESC, s.id DESC LIMIT $${params.length}`, params)).rows);
  return rows.map(mapSms);
}

// ─── جزئیاتِ یک درخواست ─────────────────────────────────────────────────────

export interface AdminRequestDetail {
  request: AdminRequestRow;
  channel: { id: string; kind: string; holderName: string | null; bankName: string | null; cardMasked: string | null; active: boolean; scope: string };
  matchedSms: AdminSmsRow | null;
  /** پیامک‌های unmatched/ambiguousِ همین کانال که مبلغشان دقیقاً برابرِ مبلغِ نهاییِ این درخواست است (برایِ تخصیصِ دستی). */
  candidateSms: AdminSmsRow[];
  events: PaymentEventRow[];
}

export async function getAdminRequestDetail(pool: PoolLike, requestId: string): Promise<AdminRequestDetail | null> {
  return withClient(pool, async (c) => {
    const { rows } = await c.query(`${REQUEST_SELECT} WHERE r.id = $1`, [requestId]);
    if (!rows[0]) return null;
    const req = mapAdminRequest(rows[0]);
    const { rows: chRows } = await c.query("SELECT * FROM payment_channels WHERE id = $1", [req.channelId]);
    const ch = chRows[0];
    const matched = req.matchedSmsId
      ? (await c.query(`${SMS_SELECT} WHERE s.id = $1`, [req.matchedSmsId])).rows[0] : null;
    const cand = (req.status === "pending" || req.status === "awaiting_review")
      ? (await c.query(
        `${SMS_SELECT} WHERE s.channel_id = $1 AND s.status IN ('unmatched','ambiguous') AND s.parsed_ok AND s.direction = 'deposit'
            AND s.amount_rial = $2::bigint ORDER BY s.ingested_at DESC LIMIT 10`, [req.channelId, req.finalAmountRial])).rows
      : [];
    const ev = (await c.query("SELECT * FROM payment_events WHERE request_id = $1 ORDER BY at, id LIMIT 100", [requestId])).rows;
    return {
      request: req,
      channel: { id: ch.id, kind: ch.kind, holderName: ch.holder_name, bankName: ch.bank_name, cardMasked: safeCardMask(ch.card_number_enc), active: ch.active, scope: ch.scope },
      matchedSms: matched ? mapSms(matched) : null,
      candidateSms: cand.map(mapSms),
      events: ev.map((r) => ({
        id: r.id, at: r.at, level: r.level, kind: r.kind, scope: r.scope, botId: r.bot_id, channelId: r.channel_id, requestId: r.request_id,
        smsId: r.sms_id, actor: r.actor, message: r.message, data: r.data ?? {},
      })),
    };
  });
}

/** فیشِ آپلودی. سوپرادمین فقط؛ برایِ bot-scope `file_id` تلگرام است (قابلِ نمایش در وب نیست). */
export async function getReceipt(
  pool: PoolLike, requestId: string,
): Promise<{ kind: "image" | "telegram_file_id" | "none"; value: string | null; uploadedAt: Date | null }> {
  const row = await withClient(pool, async (c) => (await c.query(
    "SELECT scope, receipt_file_id, receipt_uploaded_at FROM payment_requests WHERE id = $1", [requestId])).rows[0]);
  if (!row) throw new PaymentRequestError("درخواست پیدا نشد.", "not_found");
  if (!row.receipt_file_id) return { kind: "none", value: null, uploadedAt: null };
  const isImage = row.scope === "platform" && /^data:image\/(webp|png|jpeg|jpg);base64,/.test(row.receipt_file_id);
  return { kind: isImage ? "image" : "telegram_file_id", value: isImage ? row.receipt_file_id : null, uploadedAt: row.receipt_uploaded_at };
}

// ─── تخصیصِ دستیِ پیامک به درخواست ──────────────────────────────────────────

/**
 * سوپرادمین یک پیامکِ `unmatched`/`ambiguous` را به یک درخواستِ فعالِ **همان کانال** وصل می‌کند (مثلاً برایِ حلِ ابهام یا پیامکِ
 * دیررسید). همان `confirmRequestTx` و همان قفل‌ها و effectِ داخلِ تراکنشِ موتورِ خودکار؛ پس اثرِ مالی دقیقاً یک‌بار و اولین
 * تصمیم برنده است. شرط‌ها: پیامکِ واریزِ قابل‌فهم؛ مبلغش **دقیقاً** برابرِ مبلغِ نهاییِ درخواست (نه «تقریباً»).
 */
export async function assignSmsToRequest(
  pool: PoolLike,
  input: { smsId: string; requestId: string; adminId: string; now?: Date; getEffect?: (scope: string, purpose: string) => PaymentEffect | undefined },
): Promise<{ request: PaymentRequestRow; promoted: PaymentRequestRow[] }> {
  const now = input.now ?? new Date();
  const getEffect = input.getEffect ?? getPaymentEffect;
  const pre = await withClient(pool, async (c) => (await c.query(
    `SELECT s.channel_id AS sms_channel, r.channel_id AS req_channel
       FROM sms_inbox s, payment_requests r WHERE s.id = $1 AND r.id = $2`, [input.smsId, input.requestId])).rows[0]);
  if (!pre) throw new PaymentRequestError("پیامک یا درخواست پیدا نشد.", "not_found");
  if (pre.sms_channel !== pre.req_channel) {
    throw new PaymentRequestError("پیامک و درخواست به یک کانال تعلق ندارند.", "channel_mismatch");
  }
  const after: { request?: PaymentRequestRow } = {};
  const result = await withChannelLock(pool, pre.req_channel, async (c) => {
    const { rows: sr } = await c.query("SELECT * FROM sms_inbox WHERE id = $1 FOR UPDATE", [input.smsId]);
    const { rows: rr } = await c.query("SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE", [input.requestId]);
    const sms = sr[0], req = rr[0];
    if (!sms || !req) throw new PaymentRequestError("پیامک یا درخواست پیدا نشد.", "not_found");
    if (!["unmatched", "ambiguous"].includes(sms.status) || !sms.parsed_ok || sms.direction !== "deposit") {
      throw new PaymentRequestError("این پیامک واریزِ قابل‌تخصیص نیست (قبلاً مصرف شده یا برداشت/نامفهوم است).", "sms_not_assignable");
    }
    if (req.status !== "pending" && req.status !== "awaiting_review") {
      throw new PaymentRequestError(`وضعیتِ درخواست (${req.status}) اجازه‌ی تأیید نمی‌دهد.`, "wrong_state");
    }
    if (Number(sms.amount_rial) !== Number(req.final_amount_rial)) {
      throw new PaymentRequestError("مبلغِ پیامک دقیقاً برابرِ مبلغِ نهاییِ درخواست نیست.", "amount_mismatch");
    }
    const effect = getEffect(req.scope, req.purpose);
    if (!effect) throw new PaymentRequestError(`برای ${req.scope}:${req.purpose} مسیرِ تأیید تنظیم نشده.`, "no_effect");
    const confirmed = await confirmRequestTx(c, { requestId: req.id, by: "admin", adminId: input.adminId, smsId: sms.id, now });
    if (!confirmed) throw new PaymentRequestError("درخواست همین الان توسطِ تصمیمِ دیگری بسته شد.", "wrong_state");
    const promoted = await promoteQueue(c, pre.req_channel, { now });
    await effect(c, confirmed);
    after.request = confirmed;
    return { request: confirmed, promoted };
  });
  await logPaymentEvent(pool, {
    kind: "sms_assigned_by_admin", scope: result.request.scope, botId: result.request.botId, channelId: result.request.channelId,
    requestId: result.request.id, smsId: input.smsId, actor: `admin:${input.adminId}`,
    message: "پیامک توسطِ سوپرادمین به درخواست تخصیص داده و تأیید شد", data: { finalAmountRial: result.request.finalAmountRial },
  });
  return result;
}

export { mapRow };
