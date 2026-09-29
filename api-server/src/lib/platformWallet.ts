/**
 * lib/platformWallet.ts — شارژِ کیف‌پولِ خودِ IrForge روی ماژولِ مشترکِ کارت‌به‌کارت
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۸؛ scope=platform).
 *
 * جایگزینِ `walletTopupService.ts` + `walletTopupSmsWebhook.ts` (مسیرِ قدیمیِ بلوبانک؛ حذف شد). همان مدلِ
 * `paymentBotApi.ts` ولی برایِ `scope='platform'`:
 *  - کانال از سوپرادمین (کارت/لینکِ ثابت/لینکِ باز)؛ فقط کانالِ **فعالِ platform** — هرگز از ورودیِ کاربر scope نمی‌آید؛
 *  - مبلغِ یکتا (پسوندِ مضربِ ۱۰ ریال)، صفِ لینکِ ثابت، مهلتِ ۳۰ دقیقه؛
 *  - مسیرِ پشتیبان: آپلودِ فیش → `awaiting_review` → تأییدِ دستیِ سوپرادمین؛
 *  - شارژِ کیف‌پول **داخلِ تراکنشِ تأیید** (`platformWalletEffect.ts`).
 *
 * همه‌ی مبالغِ داخلی عدد صحیحِ ریال؛ تبدیل به تومان فقط در مرزِ API (route).
 */
import { decryptToken } from "./tokenCrypto";
import {
  closePaymentRequest, createPaymentRequest, expireDueRequests, mapRow, PaymentRequestError, withChannelLock,
  type PaymentRequestRow, type PoolLike,
} from "./paymentRequests";
import { retestUnmatchedForRequest } from "./paymentMatcher";
import { buildView, MAX_ACTIVE_PER_USER, withClient, withUserLock, type BotPaymentView } from "./paymentBotApi";
import type { MatchAlerts } from "./paymentAlerts";

/** پیش‌ستِ مبلغ‌ها در UI (تومان) — طبقِ مشخصاتِ فاز ۸. */
export const TOPUP_PRESETS_TOMAN = [100_000, 200_000, 500_000, 700_000, 1_000_000] as const;
export const TOPUP_MIN_TOMAN = 100_000;
export const TOPUP_MAX_TOMAN = 50_000_000;
/** سقفِ اندازه‌ی فیش (data URL webp/png/jpeg) — بدنه‌ی JSONِ مسیرهای عادی ۲۵۶KB است. */
export const MAX_RECEIPT_DATA_URL = 190_000;
const ACTIVE = ["queued", "pending", "awaiting_review"];
const RECEIPT_RE = /^data:image\/(webp|png|jpeg|jpg);base64,[A-Za-z0-9+/=]+$/;

export interface PlatformChannelInfo {
  id: string;
  kind: "card_manual" | "fixed_link" | "open_link";
  holderName: string | null;
  bankName: string | null;
  minAmountToman: number;
  /** فقط ۴ رقمِ آخر، برایِ برچسبِ انتخابِ حساب؛ شماره‌ی کامل فقط داخلِ یک درخواستِ فعال دیده می‌شود. */
  cardLast4: string | null;
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

const toInfo = (r: any): PlatformChannelInfo => ({
  id: r.id, kind: r.kind, holderName: r.holder_name ?? null, bankName: r.bank_name ?? null,
  minAmountToman: Math.round(Number(r.min_amount_rial) / 10), cardLast4: last4(r.card_number_enc ?? null),
});

/** کانال‌های فعالِ platform (قدیمی‌ترین اول). */
export async function listActivePlatformChannels(pool: PoolLike): Promise<PlatformChannelInfo[]> {
  return withClient(pool, async (c) => {
    const { rows } = await c.query(
      "SELECT * FROM payment_channels WHERE scope = 'platform' AND bot_id IS NULL AND active ORDER BY created_at, id");
    return rows.map(toInfo);
  });
}

export function validateTopupAmountToman(amountToman: unknown, channelMinToman = TOPUP_MIN_TOMAN): number {
  const n = Number(amountToman);
  const min = Math.max(TOPUP_MIN_TOMAN, channelMinToman);
  if (!Number.isSafeInteger(n) || n < min || n > TOPUP_MAX_TOMAN) {
    throw new PaymentRequestError(
      `مبلغ باید عددِ صحیحی بینِ ${min.toLocaleString("en-US")} و ${TOPUP_MAX_TOMAN.toLocaleString("en-US")} تومان باشد.`,
      "invalid_amount");
  }
  return n;
}

async function loadOwned(pool: PoolLike, userId: string, requestId: string): Promise<any | null> {
  return withClient(pool, async (c) => {
    const { rows } = await c.query(
      "SELECT * FROM payment_requests WHERE id = $1 AND scope = 'platform' AND user_id = $2 AND purpose = 'wallet_topup'",
      [requestId, userId]);
    return rows[0] ?? null;
  });
}

async function pickChannel(pool: PoolLike, channelId?: string | null): Promise<any> {
  const row = await withClient(pool, async (c) => {
    const { rows } = channelId
      ? await c.query("SELECT * FROM payment_channels WHERE id = $1 AND scope = 'platform' AND bot_id IS NULL", [channelId])
      : await c.query(
        `SELECT * FROM payment_channels WHERE scope = 'platform' AND bot_id IS NULL AND active
          ORDER BY created_at DESC, id LIMIT 1`);
    return rows[0] ?? null;
  });
  if (!row || !row.active) throw new PaymentRequestError("شارژِ خودکارِ کیف‌پول فعلاً فعال نیست.", "no_channel");
  return row;
}

export interface CreatePlatformTopupInput {
  userId: string;
  amountToman: unknown;
  channelId?: string | null;
  alerts?: MatchAlerts;
  now?: Date;
  expiryMs?: number;
  queueTtlMs?: number;
  randomInt?: (n: number) => number;
}

/**
 * درخواستِ شارژِ تازه. همان (کاربر، مبلغ) که فعال است → همان را برمی‌گرداند (کلیکِ دوباره امن است)؛
 * مبلغِ دیگر → `active_request_exists`؛ حداکثر `MAX_ACTIVE_PER_USER` درخواستِ فعال.
 */
export async function createPlatformTopup(
  pool: PoolLike, input: CreatePlatformTopupInput,
): Promise<{ payment: BotPaymentView; existing: boolean }> {
  await expireDueRequests(pool, { now: input.now }).catch(() => undefined);
  const channel = await pickChannel(pool, input.channelId);
  const toman = validateTopupAmountToman(input.amountToman, Math.round(Number(channel.min_amount_rial) / 10));
  const baseRial = toman * 10;

  return withUserLock(pool, `platform:${input.userId}`, async () => {
    const active = await withClient(pool, async (c) => {
      const { rows } = await c.query(
        `SELECT * FROM payment_requests
          WHERE scope = 'platform' AND purpose = 'wallet_topup' AND user_id = $1 AND status = ANY($2::text[])
          ORDER BY created_at, id`, [input.userId, ACTIVE]);
      return rows;
    });
    const same = active.find((r) => Number(r.base_amount_rial) === baseRial && r.channel_id === channel.id);
    if (same) return { payment: await buildView(pool, same), existing: true };
    if (active.length >= MAX_ACTIVE_PER_USER) {
      throw new PaymentRequestError("تعدادِ درخواست‌های فعالِ شما به سقف رسیده است؛ یکی را لغو یا تکمیل کنید.", "active_request_limit");
    }
    const { request } = await createPaymentRequest(pool, {
      channelId: channel.id, channelScope: { scope: "platform" }, userId: input.userId, purpose: "wallet_topup",
      baseAmountRial: baseRial, now: input.now, expiryMs: input.expiryMs, queueTtlMs: input.queueTtlMs, randomInt: input.randomInt,
    });
    await retestUnmatchedForRequest(pool, request.id, { alerts: input.alerts, now: input.now }).catch(() => undefined);
    const fresh = await loadOwned(pool, input.userId, request.id);
    return { payment: await buildView(pool, fresh), existing: false };
  });
}

/** وضعیتِ یک درخواستِ همین کاربر (سررسیدشده پیش از خواندن منقضی می‌شود) یا null. */
export async function getPlatformTopup(pool: PoolLike, userId: string, requestId: string, now?: Date): Promise<BotPaymentView | null> {
  await expireDueRequests(pool, { now }).catch(() => undefined);
  const row = await loadOwned(pool, userId, requestId);
  return row ? buildView(pool, row) : null;
}

/** تاریخچه‌ی اخیرِ کاربر (شماره‌کارت هرگز؛ فقط برایِ فهرست). */
export async function listPlatformTopups(pool: PoolLike, userId: string, limit = 20): Promise<BotPaymentView[]> {
  await expireDueRequests(pool).catch(() => undefined);
  const rows = await withClient(pool, async (c) => {
    const { rows } = await c.query(
      `SELECT * FROM payment_requests
        WHERE scope = 'platform' AND purpose = 'wallet_topup' AND user_id = $1
        ORDER BY created_at DESC, id LIMIT $2`, [userId, Math.min(Math.max(limit, 1), 50)]);
    return rows;
  });
  return Promise.all(rows.map((r) => buildView(pool, r, { includePayTarget: false })));
}

/** لغوِ توسطِ خودِ کاربر: فقط queued/pending (بعد از فیش فقط سوپرادمین تصمیم می‌گیرد). */
export async function cancelPlatformTopup(
  pool: PoolLike, input: { userId: string; requestId: string; now?: Date },
): Promise<{ payment: BotPaymentView; promoted: PaymentRequestRow[] }> {
  const pre = await loadOwned(pool, input.userId, input.requestId);
  if (!pre) throw new PaymentRequestError("درخواست پیدا نشد.", "not_found");
  const res = await closePaymentRequest(pool, {
    requestId: input.requestId, to: "canceled", from: ["queued", "pending"], expectedUserId: input.userId, now: input.now,
  });
  if (!res.closed) {
    const cur = await loadOwned(pool, input.userId, input.requestId);
    throw new PaymentRequestError(`وضعیتِ فعلی (${cur?.status ?? "؟"}) اجازه‌ی لغو نمی‌دهد.`, "wrong_state");
  }
  const fresh = await loadOwned(pool, input.userId, input.requestId);
  return { payment: await buildView(pool, fresh), promoted: res.promoted };
}

/** فیشِ تصویری: `pending → awaiting_review`. فقط صاحبِ درخواست، فقط از pending؛ فقط تصویرِ data-URL. */
export async function submitPlatformReceipt(
  pool: PoolLike, input: { userId: string; requestId: string; receiptDataUrl: unknown; alerts?: MatchAlerts; now?: Date },
): Promise<BotPaymentView> {
  const url = typeof input.receiptDataUrl === "string" ? input.receiptDataUrl.trim() : "";
  if (!url || url.length > MAX_RECEIPT_DATA_URL || !RECEIPT_RE.test(url)) {
    throw new PaymentRequestError("فیش باید یک تصویرِ معتبر (webp/png/jpeg) و کوچک‌تر از حدِ مجاز باشد.", "invalid_receipt");
  }
  const pre = await loadOwned(pool, input.userId, input.requestId);
  if (!pre) throw new PaymentRequestError("درخواست پیدا نشد.", "not_found");
  const changed = await withChannelLock(pool, pre.channel_id, async (c) => {
    const { rows } = await c.query(
      `UPDATE payment_requests SET status = 'awaiting_review', receipt_file_id = $3, receipt_uploaded_at = $4
        WHERE id = $1 AND scope = 'platform' AND user_id = $2 AND status = 'pending' RETURNING id`,
      [input.requestId, input.userId, url, input.now ?? new Date()]);
    return rows.length === 1;
  });
  if (!changed) {
    const cur = await loadOwned(pool, input.userId, input.requestId);
    throw new PaymentRequestError(`وضعیتِ فعلی (${cur?.status ?? "؟"}) اجازه‌ی ثبتِ فیش نمی‌دهد.`, "wrong_state");
  }
  await retestUnmatchedForRequest(pool, input.requestId, { alerts: input.alerts, now: input.now }).catch(() => undefined);
  const fresh = await loadOwned(pool, input.userId, input.requestId);
  return buildView(pool, fresh);
}

export { mapRow };
