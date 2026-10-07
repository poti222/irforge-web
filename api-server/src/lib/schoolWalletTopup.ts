/**
 * lib/schoolWalletTopup.ts — شارژِ «کیف‌پولِ مدرسه» روی همان ماژولِ کارت‌به‌کارتِ خودکار (scope=platform، purpose=school_wallet_topup).
 * ─────────────────────────────────────────────────────────────────────────
 * دقیقاً هم‌ساختارِ `platformWallet.ts`؛ همان کانال‌هایِ فعالِ platform، همان مبلغِ یکتا (استخرِ پسوندِ مشترکِ کانال، پس درخواستِ
 * شخصی و مدرسه‌ای هرگز مبلغِ نهاییِ یکسان نمی‌گیرند)، همان صف/مهلت/فیش، و همان تطبیقِ پیامک. تفاوت‌ها:
 *  - مالکِ درخواست «مدرسه» است (ستونِ school_id)، نه کاربر: همه‌ی مدیرانِ همان مدرسه آن را می‌بینند؛ `user_id` مدیرِ ایجادکننده است.
 *  - اثرِ تأیید `schoolWalletEffect.ts` است (school_wallets)، نه کیف‌پولِ شخصی.
 *  - هیچ‌کدام از کوئری‌هایِ مسیرِ شخصی (purpose='wallet_topup') این ردیف‌ها را نمی‌بینند و برعکس.
 */
import {
  closePaymentRequest, createPaymentRequest, expireDueRequests, PaymentRequestError, withChannelLock,
  type PoolLike,
} from "./paymentRequests";
import { retestUnmatchedForRequest } from "./paymentMatcher";
import { buildView, MAX_ACTIVE_PER_USER, withClient, withUserLock, type BotPaymentView } from "./paymentBotApi";
import { validateTopupAmountToman, MAX_RECEIPT_DATA_URL } from "./platformWallet";
import type { MatchAlerts } from "./paymentAlerts";

const ACTIVE = ["queued", "pending", "awaiting_review"];
const RECEIPT_RE = /^data:image\/(webp|png|jpeg|jpg);base64,[A-Za-z0-9+/=]+$/;
const PURPOSE = "school_wallet_topup";

async function loadOwned(pool: PoolLike, schoolId: string, requestId: string): Promise<any | null> {
  return withClient(pool, async (c) => {
    const { rows } = await c.query(
      "SELECT * FROM payment_requests WHERE id = $1 AND scope = 'platform' AND purpose = $3 AND school_id = $2",
      [requestId, schoolId, PURPOSE]);
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

export interface CreateSchoolTopupInput {
  schoolId: string;
  userId: string;
  amountToman: unknown;
  channelId?: string | null;
  alerts?: MatchAlerts;
  now?: Date;
  expiryMs?: number;
  queueTtlMs?: number;
  randomInt?: (n: number) => number;
}

export async function createSchoolTopup(
  pool: PoolLike, input: CreateSchoolTopupInput,
): Promise<{ payment: BotPaymentView; existing: boolean }> {
  await expireDueRequests(pool, { now: input.now }).catch(() => undefined);
  const channel = await pickChannel(pool, input.channelId);
  const toman = validateTopupAmountToman(input.amountToman, Math.round(Number(channel.min_amount_rial) / 10));
  const baseRial = toman * 10;

  return withUserLock(pool, `school:${input.schoolId}`, async () => {
    const active = await withClient(pool, async (c) => {
      const { rows } = await c.query(
        `SELECT * FROM payment_requests
          WHERE scope = 'platform' AND purpose = $3 AND school_id = $1 AND status = ANY($2::text[])
          ORDER BY created_at, id`, [input.schoolId, ACTIVE, PURPOSE]);
      return rows;
    });
    const same = active.find((r) => Number(r.base_amount_rial) === baseRial && r.channel_id === channel.id);
    if (same) return { payment: await buildView(pool, same), existing: true };
    if (active.length >= MAX_ACTIVE_PER_USER) {
      throw new PaymentRequestError("تعدادِ درخواست‌های فعالِ مدرسه به سقف رسیده است؛ یکی را لغو یا تکمیل کنید.", "active_request_limit");
    }
    const { request } = await createPaymentRequest(pool, {
      channelId: channel.id, channelScope: { scope: "platform" }, userId: input.userId, purpose: PURPOSE, schoolId: input.schoolId,
      baseAmountRial: baseRial, now: input.now, expiryMs: input.expiryMs, queueTtlMs: input.queueTtlMs, randomInt: input.randomInt,
    });
    await retestUnmatchedForRequest(pool, request.id, { alerts: input.alerts, now: input.now }).catch(() => undefined);
    const fresh = await loadOwned(pool, input.schoolId, request.id);
    return { payment: await buildView(pool, fresh), existing: false };
  });
}

export async function getSchoolTopup(pool: PoolLike, schoolId: string, requestId: string, now?: Date): Promise<BotPaymentView | null> {
  await expireDueRequests(pool, { now }).catch(() => undefined);
  const row = await loadOwned(pool, schoolId, requestId);
  return row ? buildView(pool, row) : null;
}

export async function listSchoolTopups(pool: PoolLike, schoolId: string, limit = 20): Promise<BotPaymentView[]> {
  await expireDueRequests(pool).catch(() => undefined);
  const rows = await withClient(pool, async (c) => {
    const { rows } = await c.query(
      `SELECT * FROM payment_requests
        WHERE scope = 'platform' AND purpose = $3 AND school_id = $1
        ORDER BY created_at DESC, id LIMIT $2`, [schoolId, Math.min(Math.max(limit, 1), 50), PURPOSE]);
    return rows;
  });
  return Promise.all(rows.map((r) => buildView(pool, r, { includePayTarget: false })));
}

/** لغو: فقط queued/pending. expectedUserId = ایجادکننده (هر مدیرِ همان مدرسه می‌تواند لغو کند؛ مالکیت با school_id چک شده). */
export async function cancelSchoolTopup(
  pool: PoolLike, input: { schoolId: string; requestId: string; now?: Date },
): Promise<{ payment: BotPaymentView }> {
  const pre = await loadOwned(pool, input.schoolId, input.requestId);
  if (!pre) throw new PaymentRequestError("درخواست پیدا نشد.", "not_found");
  const res = await closePaymentRequest(pool, {
    requestId: input.requestId, to: "canceled", from: ["queued", "pending"], expectedUserId: pre.user_id, now: input.now,
  });
  if (!res.closed) {
    const cur = await loadOwned(pool, input.schoolId, input.requestId);
    throw new PaymentRequestError(`وضعیتِ فعلی (${cur?.status ?? "؟"}) اجازه‌ی لغو نمی‌دهد.`, "wrong_state");
  }
  const fresh = await loadOwned(pool, input.schoolId, input.requestId);
  return { payment: await buildView(pool, fresh) };
}

export async function submitSchoolReceipt(
  pool: PoolLike, input: { schoolId: string; requestId: string; receiptDataUrl: unknown; alerts?: MatchAlerts; now?: Date },
): Promise<BotPaymentView> {
  const url = typeof input.receiptDataUrl === "string" ? input.receiptDataUrl.trim() : "";
  if (!url || url.length > MAX_RECEIPT_DATA_URL || !RECEIPT_RE.test(url)) {
    throw new PaymentRequestError("فیش باید یک تصویرِ معتبر (webp/png/jpeg) و کوچک‌تر از حدِ مجاز باشد.", "invalid_receipt");
  }
  const pre = await loadOwned(pool, input.schoolId, input.requestId);
  if (!pre) throw new PaymentRequestError("درخواست پیدا نشد.", "not_found");
  const changed = await withChannelLock(pool, pre.channel_id, async (c) => {
    const { rows } = await c.query(
      `UPDATE payment_requests SET status = 'awaiting_review', receipt_file_id = $3, receipt_uploaded_at = $4
        WHERE id = $1 AND scope = 'platform' AND purpose = $5 AND school_id = $2 AND status = 'pending' RETURNING id`,
      [input.requestId, input.schoolId, url, input.now ?? new Date(), PURPOSE]);
    return rows.length === 1;
  });
  if (!changed) {
    const cur = await loadOwned(pool, input.schoolId, input.requestId);
    throw new PaymentRequestError(`وضعیتِ فعلی (${cur?.status ?? "؟"}) اجازه‌ی ثبتِ فیش نمی‌دهد.`, "wrong_state");
  }
  await retestUnmatchedForRequest(pool, input.requestId, { alerts: input.alerts, now: input.now }).catch(() => undefined);
  const fresh = await loadOwned(pool, input.schoolId, input.requestId);
  return buildView(pool, fresh);
}
