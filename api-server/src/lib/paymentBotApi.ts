/**
 * lib/paymentBotApi.ts — عملیاتِ ماژولِ پرداخت برای باتِ فروشنده
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۵). لایه‌ی نازکِ بالای `paymentRequests`
 * که همه‌چیز را به یک `botId` محدود می‌کند:
 *
 *  - `botId` همیشه پارامترِ **سرور** است (route آن را از `spreadsheetId`ِ tenantِ
 *    جاری resolve می‌کند)، هرگز از بدنه‌ی کاربر/LLM. هر query با
 *    `scope='bot' AND bot_id=$botId` فیلتر می‌شود؛ درخواستِ بات دیگر مثلِ «وجود
 *    ندارد» (`not_found`) رفتار می‌کند تا وجودش هم لو نرود.
 *  - شماره‌کارت فقط برای درخواست‌های `pending`/`awaiting_review` (جایی که کاربر
 *    باید واریز کند) و فقط در پاسخِ همین API رمزگشایی می‌شود؛ هرگز لاگ نمی‌شود.
 *  - اثرِ تجاریِ تأیید (شارژ کیف‌پول/سفارش) در خودِ بات اجرا می‌شود؛ برایِ یک‌بار
 *    اجرا شدنش `claimBotEffect` یک UPDATE اتمیک است (at-most-once، بدون lease):
 *    بات بمیرد، ردیف claimشده ولی done‌نشده می‌ماند و ادمین باخبر می‌شود — هرگز
 *    دوبار اعمال نمی‌شود.
 *
 * ترتیبِ قفل مثلِ بقیه: قفلِ کانال ← ردیف. `withUserLock` فقط برای هم‌زمانیِ
 * «ساختِ درخواست» است و قبل از قفلِ کانال گرفته می‌شود (هیچ مسیری برعکسِ آن نمی‌گیرد).
 */
import { decryptToken } from "./tokenCrypto";
import {
  closePaymentRequest, createPaymentRequest, expireDueRequests, mapRow, queueAheadOf, withChannelLock,
  PaymentRequestError,
  type ClientLike, type PaymentRequestRow, type PoolLike,
} from "./paymentRequests";
import { retestUnmatchedForRequest } from "./paymentMatcher";
import { decideRequestByAdmin, type AdminDecision } from "./paymentDecisions";
import { registerDefaultPaymentEffects } from "./paymentEffectsBoot";
import type { MatchAlerts } from "./paymentAlerts";

// effectِ «فقط وضعیت» برایِ scope=bot باید ثبت باشد وگرنه موتورِ تطبیق (fail-closed) تأیید نمی‌کند.
registerDefaultPaymentEffects();

/** سقفِ درخواستِ فعال به‌ازای هر کاربر در هر کانال (جلوگیری از پر کردنِ فضای suffix). */
export const MAX_ACTIVE_PER_USER = 3;
const ACTIVE_STATUSES = ["queued", "pending", "awaiting_review"];
const MAX_RECEIPT_FILE_ID = 256;

export type PaymentPurpose = "wallet_topup" | "order";

export interface BotChannelInfo {
  id: string;
  kind: "card_manual" | "fixed_link" | "open_link";
  holderName: string | null;
  bankName: string | null;
  minAmountRial: number;
  active: boolean;
  /** فقط ۴ رقمِ آخرِ کارت (برایِ برچسبِ انتخابِ حساب در بات)؛ null برایِ کانالِ لینکی. */
  cardLast4: string | null;
}

export interface BotPaymentView {
  id: string;
  status: string;
  purpose: PaymentPurpose;
  orderId: string | null;
  userId: string;
  baseAmountRial: number;
  suffixRial: number;
  finalAmountRial: number;
  createdAt: Date;
  expiresAt: Date | null;
  /** فقط برای `queued`: چند نفر جلوترند. */
  queuedAhead: number | null;
  receiptUploadedAt: Date | null;
  confirmedBy: "sms" | "admin" | null;
  confirmedAt: Date | null;
  /** ادمینی که تأیید/رد کرده (تأییدِ دستی یا ردِ دستی)، وگرنه null. */
  decidedByAdminId: string | null;
  rejectReason: string | null;
  effectClaimed: boolean;
  effectDone: boolean;
  channel: {
    id: string;
    kind: string;
    holderName: string | null;
    bankName: string | null;
    /** فقط وقتی status ∈ {pending, awaiting_review} — وگرنه null. */
    cardNumber: string | null;
    paymentUrl: string | null;
  };
}

function last4(enc: string | null): string | null {
  if (!enc) return null;
  try {
    const d = decryptToken(enc).replace(/\D/g, "");
    return d.length >= 4 ? d.slice(-4) : null;
  } catch {
    return null;
  }
}

function toChannelInfo(r: any): BotChannelInfo {
  return {
    id: r.id, kind: r.kind, holderName: r.holder_name ?? null, bankName: r.bank_name ?? null,
    minAmountRial: Number(r.min_amount_rial), active: Boolean(r.active), cardLast4: last4(r.card_number_enc ?? null),
  };
}

async function withClient<T>(pool: PoolLike, fn: (c: ClientLike) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { return await fn(c); } finally { c.release(); }
}

/** قفلِ هم‌زمانیِ «یک کاربر در یک کانال» — روی یک اتصالِ جدا نگه داشته می‌شود. */
async function withUserLock<T>(pool: PoolLike, key: string, fn: () => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`payuser:${key}`]);
    const out = await fn();
    await c.query("COMMIT");
    return out;
  } catch (err) {
    try { await c.query("ROLLBACK"); } catch { /* اتصال افتاده */ }
    throw err;
  } finally {
    c.release();
  }
}

// ─── کانال ──────────────────────────────────────────────────────────────────

/** کانالِ فعالِ این بات (تازه‌ترین) یا null. شماره‌کارت برنمی‌گردد. */
export async function getActiveBotChannel(pool: PoolLike, botId: string): Promise<BotChannelInfo | null> {
  return withClient(pool, async (c) => {
    const { rows } = await c.query(
      `SELECT * FROM payment_channels WHERE scope = 'bot' AND bot_id = $1 AND active
        ORDER BY created_at DESC, id LIMIT 1`, [botId]);
    return rows[0] ? toChannelInfo(rows[0]) : null;
  });
}

/** همه‌ی کانال‌های فعالِ این بات (قدیمی‌ترین اول) — برایِ انتخابِ حسابِ مقصد در بات. */
export async function listActiveBotChannels(pool: PoolLike, botId: string): Promise<BotChannelInfo[]> {
  return withClient(pool, async (c) => {
    const { rows } = await c.query(
      `SELECT * FROM payment_channels WHERE scope = 'bot' AND bot_id = $1 AND active ORDER BY created_at, id`, [botId]);
    return rows.map(toChannelInfo);
  });
}

async function loadBotChannelRow(c: ClientLike, botId: string, channelId?: string | null): Promise<any | null> {
  const { rows } = channelId
    ? await c.query("SELECT * FROM payment_channels WHERE id = $1 AND scope = 'bot' AND bot_id = $2", [channelId, botId])
    : await c.query(
      `SELECT * FROM payment_channels WHERE scope = 'bot' AND bot_id = $1 AND active
        ORDER BY created_at DESC, id LIMIT 1`, [botId]);
  return rows[0] ?? null;
}

// ─── نمایشِ درخواست ─────────────────────────────────────────────────────────

function decryptCard(enc: string | null): string | null {
  if (!enc) return null;
  const parts = enc.split(":");
  // ذخیره‌ی plaintext (بدونِ قالبِ iv:tag:ct) هرگز پذیرفته نمی‌شود.
  if (parts.length !== 3) throw new PaymentRequestError("card_unavailable", "card_unavailable");
  try {
    return decryptToken(enc);
  } catch {
    throw new PaymentRequestError("card_unavailable", "card_unavailable");
  }
}

async function buildView(pool: PoolLike, row: any, opts: { includePayTarget?: boolean } = {}): Promise<BotPaymentView> {
  const r = mapRow(row);
  const showPay = (opts.includePayTarget ?? true) && (r.status === "pending" || r.status === "awaiting_review");
  const ch = await withClient(pool, async (c) => {
    const { rows } = await c.query("SELECT * FROM payment_channels WHERE id = $1", [r.channelId]);
    return rows[0];
  });
  return {
    id: r.id, status: r.status, purpose: r.purpose, orderId: r.orderId, userId: r.userId,
    baseAmountRial: r.baseAmountRial, suffixRial: r.suffixRial, finalAmountRial: r.finalAmountRial,
    createdAt: r.createdAt, expiresAt: r.expiresAt,
    queuedAhead: r.status === "queued" ? await queueAheadOf(pool, r.id) : null,
    receiptUploadedAt: row.receipt_uploaded_at ?? null,
    confirmedBy: r.confirmedBy, confirmedAt: r.confirmedAt,
    decidedByAdminId: row.confirmed_by_admin_id ?? row.rejected_by_admin_id ?? null,
    rejectReason: row.reject_reason ?? null,
    effectClaimed: row.effect_claimed_at != null,
    effectDone: row.effect_done_at != null,
    channel: {
      id: r.channelId, kind: r.channelKind, holderName: ch?.holder_name ?? null, bankName: ch?.bank_name ?? null,
      cardNumber: showPay ? decryptCard(ch?.card_number_enc ?? null) : null,
      paymentUrl: showPay ? (ch?.payment_url ?? null) : null,
    },
  };
}

async function loadScoped(pool: PoolLike, botId: string, requestId: string): Promise<any | null> {
  return withClient(pool, async (c) => {
    const { rows } = await c.query(
      "SELECT * FROM payment_requests WHERE id = $1 AND scope = 'bot' AND bot_id = $2", [requestId, botId]);
    return rows[0] ?? null;
  });
}

/** وضعیتِ یک درخواستِ همین بات (یا null). درخواستِ سررسیدشده پیش از خواندن منقضی می‌شود. */
export async function getBotPayment(pool: PoolLike, botId: string, requestId: string): Promise<BotPaymentView | null> {
  await expireDueRequests(pool).catch(() => undefined);
  const row = await loadScoped(pool, botId, requestId);
  return row ? buildView(pool, row) : null;
}

/** درخواست‌های فعالِ (queued/pending/awaiting_review) این بات؛ اختیاری فقط یک کاربر. */
export async function listActiveBotPayments(
  pool: PoolLike, botId: string, opts: { userId?: string; limit?: number } = {},
): Promise<BotPaymentView[]> {
  await expireDueRequests(pool).catch(() => undefined);
  const rows = await withClient(pool, async (c) => {
    const { rows } = await c.query(
      `SELECT * FROM payment_requests
        WHERE scope = 'bot' AND bot_id = $1 AND status = ANY($2::text[]) AND ($3::text IS NULL OR user_id = $3)
        ORDER BY created_at, id LIMIT $4`,
      [botId, ACTIVE_STATUSES, opts.userId ?? null, Math.min(opts.limit ?? 200, 500)]);
    return rows;
  });
  return Promise.all(rows.map((r) => buildView(pool, r)));
}

// ─── ساخت ───────────────────────────────────────────────────────────────────

export interface CreateBotPaymentInput {
  botId: string;
  userId: string;
  purpose: PaymentPurpose;
  orderId?: string | null;
  baseAmountRial: number;
  channelId?: string | null;
  alerts?: MatchAlerts;
  now?: Date;
  expiryMs?: number;
  queueTtlMs?: number;
  randomInt?: (n: number) => number;
}

export interface CreateBotPaymentResult {
  payment: BotPaymentView;
  /** true اگر همین درخواست از قبل فعال بود (ساختِ idempotent/retry). */
  existing: boolean;
}

/**
 * درخواستِ پرداختِ تازه برای یک کاربرِ بات. قواعد:
 *  - کانالِ فعالِ بات لازم است (`no_channel`)؛
 *  - همان `(کاربر، purpose، order)` که از قبل فعال است: با همان مبلغ → همان را برمی‌گرداند
 *    (idempotent)، با مبلغِ دیگر → `active_request_exists`؛
 *  - حداکثر `MAX_ACTIVE_PER_USER` درخواستِ فعال در هر کانال (`active_request_limit`).
 * پس از ساخت، پیامک‌های unmatchedِ ۱۵ دقیقه‌ی اخیر یک‌بار retest می‌شوند (فاز ۴)؛ اگر
 * همان لحظه تأیید شد، `payment.status` همان را نشان می‌دهد.
 */
export async function createBotPayment(pool: PoolLike, input: CreateBotPaymentInput): Promise<CreateBotPaymentResult> {
  const orderId = input.orderId ?? null;
  if ((input.purpose === "order") !== (orderId !== null)) {
    throw new PaymentRequestError("order_id فقط و حتماً برای purpose=order لازم است.", "invalid_order");
  }
  await expireDueRequests(pool, { now: input.now }).catch(() => undefined);

  const channelRow = await withClient(pool, (c) => loadBotChannelRow(c, input.botId, input.channelId));
  if (!channelRow || !channelRow.active) {
    throw new PaymentRequestError("برای این بات کانالِ پرداختِ فعال تنظیم نشده.", "no_channel");
  }

  return withUserLock(pool, `${input.botId}:${channelRow.id}:${input.userId}`, async () => {
    const existing = await withClient(pool, async (c) => {
      const { rows } = await c.query(
        `SELECT * FROM payment_requests
          WHERE scope = 'bot' AND bot_id = $1 AND channel_id = $2 AND user_id = $3 AND status = ANY($4::text[])
          ORDER BY created_at, id`,
        [input.botId, channelRow.id, input.userId, ACTIVE_STATUSES]);
      return rows;
    });
    const same = existing.find((r) => r.purpose === input.purpose && (r.order_id ?? null) === orderId);
    if (same) {
      if (Number(same.base_amount_rial) === input.baseAmountRial) {
        return { payment: await buildView(pool, same), existing: true };
      }
      throw new PaymentRequestError("برای همین مورد یک درخواستِ فعال با مبلغِ دیگر دارید.", "active_request_exists");
    }
    if (existing.length >= MAX_ACTIVE_PER_USER) {
      throw new PaymentRequestError("تعدادِ درخواست‌های فعالِ شما به سقف رسیده است.", "active_request_limit");
    }

    const { request } = await createPaymentRequest(pool, {
      channelId: channelRow.id,
      channelScope: { scope: "bot", botId: input.botId },
      userId: input.userId,
      purpose: input.purpose,
      orderId,
      baseAmountRial: input.baseAmountRial,
      now: input.now,
      expiryMs: input.expiryMs,
      queueTtlMs: input.queueTtlMs,
      randomInt: input.randomInt,
    });
    // پیامکِ دیررسید/پیش‌ازcommit — خطایش ساخت را خراب نمی‌کند.
    await retestUnmatchedForRequest(pool, request.id, { alerts: input.alerts, now: input.now }).catch(() => undefined);
    const fresh = await loadScoped(pool, input.botId, request.id);
    return { payment: await buildView(pool, fresh), existing: false };
  });
}

// ─── فیش ────────────────────────────────────────────────────────────────────

/**
 * فیش را ثبت می‌کند: `pending → awaiting_review`. فقط صاحبِ درخواست، فقط از pending.
 * بعدش یک retest می‌شود (شاید پیامکِ همین مبلغ همین الان رسیده باشد).
 */
export async function submitBotReceipt(
  pool: PoolLike,
  input: { botId: string; userId: string; requestId: string; receiptFileId: string; alerts?: MatchAlerts; now?: Date },
): Promise<BotPaymentView> {
  const fileId = String(input.receiptFileId ?? "").trim();
  if (!fileId || fileId.length > MAX_RECEIPT_FILE_ID) {
    throw new PaymentRequestError("receiptFileId نامعتبر است.", "invalid_receipt");
  }
  const pre = await loadScoped(pool, input.botId, input.requestId);
  if (!pre || pre.user_id !== input.userId) throw new PaymentRequestError("درخواست پیدا نشد.", "not_found");

  const changed = await withChannelLock(pool, pre.channel_id, async (c) => {
    const { rows } = await c.query(
      `UPDATE payment_requests
          SET status = 'awaiting_review', receipt_file_id = $4, receipt_uploaded_at = $5
        WHERE id = $1 AND scope = 'bot' AND bot_id = $2 AND user_id = $3 AND status = 'pending'
        RETURNING id`,
      [input.requestId, input.botId, input.userId, fileId, input.now ?? new Date()]);
    return rows.length === 1;
  });
  if (!changed) {
    const cur = await loadScoped(pool, input.botId, input.requestId);
    throw new PaymentRequestError(`وضعیتِ فعلی (${cur?.status ?? "؟"}) اجازه‌ی ثبتِ فیش نمی‌دهد.`, "wrong_state");
  }
  await retestUnmatchedForRequest(pool, input.requestId, { alerts: input.alerts, now: input.now }).catch(() => undefined);
  const fresh = await loadScoped(pool, input.botId, input.requestId);
  return buildView(pool, fresh);
}

// ─── لغو ────────────────────────────────────────────────────────────────────

/** لغوِ توسطِ خودِ کاربر: فقط `queued`/`pending` (بعد از فیش فقط ادمین تصمیم می‌گیرد). */
export async function cancelBotPayment(
  pool: PoolLike, input: { botId: string; userId: string; requestId: string; now?: Date },
): Promise<{ payment: BotPaymentView; promoted: PaymentRequestRow[] }> {
  const pre = await loadScoped(pool, input.botId, input.requestId);
  if (!pre || pre.user_id !== input.userId) throw new PaymentRequestError("درخواست پیدا نشد.", "not_found");
  const res = await closePaymentRequest(pool, {
    requestId: input.requestId, to: "canceled", from: ["queued", "pending"],
    expectedUserId: input.userId, now: input.now,
  });
  if (!res.closed) {
    const cur = await loadScoped(pool, input.botId, input.requestId);
    throw new PaymentRequestError(`وضعیتِ فعلی (${cur?.status ?? "؟"}) اجازه‌ی لغو نمی‌دهد.`, "wrong_state");
  }
  const fresh = await loadScoped(pool, input.botId, input.requestId);
  return { payment: await buildView(pool, fresh), promoted: res.promoted };
}

// ─── تصمیمِ ادمین ───────────────────────────────────────────────────────────

/**
 * تأیید/ردِ دستیِ ادمین روی درخواستِ همین بات. اولین تصمیم برنده است: `decided=false` یعنی
 * قبلاً (توسطِ ادمینِ دیگر یا پیامکِ بانک) تصمیم گرفته شده و `payment` همان تصمیم را نشان می‌دهد.
 * احرازِ مجوزِ ادمین کارِ خودِ بات است؛ اینجا فقط `botId`-scope و ردپا.
 */
export async function decideBotPayment(
  pool: PoolLike,
  input: { botId: string; requestId: string; decision: AdminDecision; adminId: string; reason?: string | null; now?: Date },
): Promise<{ decided: boolean; payment: BotPaymentView; promoted: PaymentRequestRow[] }> {
  const pre = await loadScoped(pool, input.botId, input.requestId);
  if (!pre) throw new PaymentRequestError("درخواست پیدا نشد.", "not_found");
  const res = await decideRequestByAdmin(pool, {
    requestId: input.requestId, decision: input.decision, adminId: input.adminId, reason: input.reason, now: input.now,
  });
  const fresh = await loadScoped(pool, input.botId, input.requestId);
  return { decided: res.decided, payment: await buildView(pool, fresh), promoted: res.promoted };
}

// ─── اثرِ تجاریِ تأیید (claim یک‌باره) ─────────────────────────────────────────

/**
 * تأییدشده‌هایی که بات هنوز اثرشان را برنداشته (برای بازیابی بعد از restart).
 * فقط `confirmed ∧ effect_claimed_at IS NULL`.
 */
export async function listUnclaimedConfirmed(pool: PoolLike, botId: string, limit = 50): Promise<BotPaymentView[]> {
  const rows = await withClient(pool, async (c) => {
    const { rows } = await c.query(
      `SELECT * FROM payment_requests
        WHERE scope = 'bot' AND bot_id = $1 AND status = 'confirmed' AND effect_claimed_at IS NULL
        ORDER BY confirmed_at, id LIMIT $2`, [botId, Math.min(limit, 200)]);
    return rows;
  });
  return Promise.all(rows.map((r) => buildView(pool, r)));
}

/**
 * «کارِ باز» برایِ همه‌ی بات‌ها با یک query (مین‌بات هر چند ثانیه یک‌بار poll می‌کند):
 * درخواست‌های فعال (queued/pending/awaiting_review) + تأییدشده‌هایی که اثرشان هنوز
 * claim نشده. هر مورد با `spreadsheetId` ی بات برمی‌گردد (کلیدِ tenant سمتِ بات). شماره‌کارت
 * برنمی‌گردد — بات هنگامِ نمایش با `get` آن را می‌گیرد.
 */
export interface BotWorkItem { spreadsheetId: string; payment: BotPaymentView }

export async function listBotWork(pool: PoolLike, limit = 300): Promise<BotWorkItem[]> {
  await expireDueRequests(pool).catch(() => undefined);
  const rows = await withClient(pool, async (c) => {
    const { rows } = await c.query(
      `SELECT r.*, b.sheet_id AS work_sheet_id
         FROM payment_requests r JOIN bots b ON b.id = r.bot_id
        WHERE r.scope = 'bot' AND b.sheet_id IS NOT NULL
          AND (r.status = ANY($1::text[]) OR (r.status = 'confirmed' AND r.effect_claimed_at IS NULL))
        ORDER BY r.created_at, r.id LIMIT $2`,
      [ACTIVE_STATUSES, Math.min(limit, 1000)]);
    return rows;
  });
  const out: BotWorkItem[] = [];
  for (const r of rows) {
    const payment = await buildView(pool, r, { includePayTarget: false });
    out.push({ spreadsheetId: r.work_sheet_id, payment });
  }
  return out;
}

/**
 * claimِ اتمیک: فقط یک تماس‌گیرنده `payment` می‌گیرد، بقیه `null` (قبلاً claim شده یا هنوز
 * confirmed نیست). بعد از اعمالِ اثر، `markBotEffectDone` صدا زده شود.
 */
export async function claimBotEffect(
  pool: PoolLike, input: { botId: string; requestId: string; now?: Date },
): Promise<BotPaymentView | null> {
  const row = await withClient(pool, async (c) => {
    const { rows } = await c.query(
      `UPDATE payment_requests SET effect_claimed_at = $3
        WHERE id = $1 AND scope = 'bot' AND bot_id = $2 AND status = 'confirmed' AND effect_claimed_at IS NULL
        RETURNING *`,
      [input.requestId, input.botId, input.now ?? new Date()]);
    return rows[0] ?? null;
  });
  return row ? buildView(pool, row) : null;
}

export async function markBotEffectDone(
  pool: PoolLike, input: { botId: string; requestId: string; now?: Date },
): Promise<boolean> {
  return withClient(pool, async (c) => {
    const { rows } = await c.query(
      `UPDATE payment_requests SET effect_done_at = $3
        WHERE id = $1 AND scope = 'bot' AND bot_id = $2 AND effect_claimed_at IS NOT NULL AND effect_done_at IS NULL
        RETURNING id`,
      [input.requestId, input.botId, input.now ?? new Date()]);
    return rows.length === 1;
  });
}

export { PaymentRequestError };
