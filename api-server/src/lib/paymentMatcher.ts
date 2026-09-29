/**
 * lib/paymentMatcher.ts — موتورِ تطبیقِ پیامکِ واریز با درخواستِ پرداخت
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۴). خروجیِ فاز ۳ (`sms_inbox`) را به
 * `payment_requests` وصل می‌کند و در یک تراکنش تأیید می‌کند.
 *
 * قواعدِ تطبیق (همه‌ی شرط‌ها هم‌زمان):
 *  1. پیامک `parsed_ok ∧ direction='deposit'` و `status='unmatched'` است؛
 *  2. درخواست در **همان کانال** است (هرگز بینِ کانال‌ها/باتِ فروشنده‌ها نه)؛
 *  3. `amount_rial == final_amount_rial` **دقیقاً**؛
 *  4. درخواست `pending` یا `awaiting_review` است؛
 *  5. زمانِ پیامک در بازه‌ی `[created_at − ۲د، expires_at + ۱۰د]` (برای
 *     `awaiting_review` سقفِ بالا برداشته می‌شود: مبلغش هنوز رزرو است و منتظرِ
 *     ادمین، پس پیامکِ دیرآمده مبهم نیست؛ کفِ پایین همچنان هست)؛
 *  6. پیامک قبلاً مصرف نشده (`sms_inbox_matched_request_uk` هم پشتوانه است).
 *
 * نتیجه: دقیقاً یک کاندید → تأییدِ خودکار؛ صفر → `unmatched` می‌ماند؛ بیش از یک
 * → `ambiguous` + هشدار (با ایندکسِ یکتای `payment_requests_active_final_uk` عملاً
 * ممکن نیست؛ دفاعِ عمیق در برابرِ drift/حذفِ ایندکس است). هرگز حدس نمی‌زنیم.
 *
 * ⚠️ ترتیبِ قفل (اجباری، مثلِ فاز ۲): اولِ **lockِ کانال**، بعد قفلِ ردیف‌ها
 * (`sms_inbox` سپس `payment_requests`). هر مسیری که درخواستی را تأیید/بسته می‌کند
 * (تأییدِ ادمین در فاز ۶، sweeper) باید همین ترتیب را رعایت کند وگرنه deadlock.
 *
 * تأیید idempotent است: `UPDATE … WHERE status IN ('pending','awaiting_review')`؛
 * بارِ دوم هیچ اثری (و هیچ effectی) اجرا نمی‌شود.
 */
import { logger } from "./logger";
import { getPaymentEffect, type PaymentEffect } from "./paymentEffects";
import type { MatchAlerts } from "./paymentAlerts";
import {
  mapRow, promoteQueue, withChannelLock,
  type ClientLike, type PaymentRequestRow, type PoolLike,
} from "./paymentRequests";

export const MATCH_BEFORE_CREATED_MS = 2 * 60 * 1000;
export const MATCH_AFTER_EXPIRY_MS = 10 * 60 * 1000;
/** پیامک‌های unmatchedِ این بازه پس از ساختِ درخواستِ تازه یک‌بار دوباره تست می‌شوند. */
export const RETEST_WINDOW_MS = 15 * 60 * 1000;

export type MatchOutcome =
  | { outcome: "confirmed"; request: PaymentRequestRow; promoted: PaymentRequestRow[] }
  | { outcome: "no_candidate" }
  | { outcome: "ambiguous"; requestIds: string[] }
  | { outcome: "skipped"; reason: "not_found" | "not_matchable" | "already_processed" }
  | { outcome: "blocked"; reason: "no_effect" | "effect_failed"; requestId: string };

export interface MatchDeps {
  now?: Date;
  alerts?: MatchAlerts;
  /** برای تست؛ پیش‌فرض ثبتِ سراسریِ `paymentEffects`. */
  getEffect?: (scope: string, purpose: string) => PaymentEffect | undefined;
  expiryMs?: number;
  randomInt?: (n: number) => number;
}

class EffectFailure extends Error {
  constructor(readonly original: unknown, readonly requestId: string) {
    super("payment effect failed");
  }
}
class SmsAlreadyConsumed extends Error {}

/** هر hook را جدا و بی‌خطر صدا می‌زند: throw نباید نتیجه‌ی تأییدِ commit‌شده را عوض کند. */
async function safely(label: string, fn: (() => void | Promise<void>) | undefined): Promise<void> {
  if (!fn) return;
  try { await fn(); } catch (err) { logger.warn({ err, hook: label }, "payment alert hook failed (non-fatal)"); }
}

/**
 * درخواست را (داخلِ تراکنش و **با lockِ کانال در دست**) تأیید می‌کند. اگر
 * درخواست دیگر فعال نباشد `null` برمی‌گرداند و هیچ اثری نمی‌گذارد.
 * مسیرِ مشترکِ تأییدِ SMS (اینجا) و تأییدِ ادمین (فاز ۶).
 */
export async function confirmRequestTx(
  c: ClientLike,
  input: {
    requestId: string;
    by: "sms" | "admin";
    smsId?: string | null;
    adminId?: string | null;
    now: Date;
  },
): Promise<PaymentRequestRow | null> {
  const { rows } = await c.query(
    `UPDATE payment_requests
        SET status = 'confirmed', queue_position = NULL, confirmed_by = $2, confirmed_by_admin_id = $3,
            matched_sms_id = $4, confirmed_at = $5
      WHERE id = $1 AND status IN ('pending', 'awaiting_review')
      RETURNING *`,
    [input.requestId, input.by, input.adminId ?? null, input.smsId ?? null, input.now],
  );
  if (!rows[0]) return null;
  if (input.smsId) {
    const sms = await c.query(
      `UPDATE sms_inbox SET status = 'matched', matched_request_id = $1
        WHERE id = $2 AND status IN ('unmatched', 'ambiguous') AND parsed_ok AND direction = 'deposit'
        RETURNING id`,
      [input.requestId, input.smsId],
    );
    if (!sms.rows[0]) throw new SmsAlreadyConsumed();
  }
  return mapRow(rows[0]);
}

/**
 * یک پیامکِ ذخیره‌شده را با درخواست‌های فعالِ همان کانال تطبیق می‌دهد و در صورتِ
 * یک‌کاندیدی تأیید می‌کند. خطای دیتابیس throw می‌شود (فراخواننده لاگ کند و پیامک
 * `unmatched` می‌ماند تا retest/sweeper)؛ خطای effect به `blocked` تبدیل می‌شود.
 */
export async function matchSms(pool: PoolLike, smsId: string, deps: MatchDeps = {}): Promise<MatchOutcome> {
  const now = deps.now ?? new Date();
  const getEffect = deps.getEffect ?? getPaymentEffect;

  const channelId = await (async () => {
    const c = await pool.connect();
    try {
      const { rows } = await c.query("SELECT channel_id FROM sms_inbox WHERE id = $1", [smsId]);
      return rows[0]?.channel_id as string | undefined;
    } finally {
      c.release();
    }
  })();
  if (!channelId) return { outcome: "skipped", reason: "not_found" };

  /** hookهایی که بعد از commit اجرا می‌شوند. */
  const after: { run?: () => Promise<void> } = {};

  let result: MatchOutcome;
  try {
    result = await withChannelLock(pool, channelId, async (c): Promise<MatchOutcome> => {
      const { rows: smsRows } = await c.query("SELECT * FROM sms_inbox WHERE id = $1 FOR UPDATE", [smsId]);
      const sms = smsRows[0];
      if (!sms) return { outcome: "skipped", reason: "not_found" };
      if (sms.status !== "unmatched") return { outcome: "skipped", reason: "already_processed" };
      if (!sms.parsed_ok || sms.direction !== "deposit" || sms.amount_rial === null) {
        return { outcome: "skipped", reason: "not_matchable" };
      }

      const amount = Number(sms.amount_rial);
      const received = new Date(sms.received_at);
      const { rows: cand } = await c.query(
        `SELECT * FROM payment_requests
          WHERE channel_id = $1 AND final_amount_rial = $2::bigint
            AND status IN ('pending', 'awaiting_review')
            AND created_at <= $3
            AND (status = 'awaiting_review' OR expires_at >= $4)
          ORDER BY created_at, id
          FOR UPDATE`,
        [channelId, amount,
          new Date(received.getTime() + MATCH_BEFORE_CREATED_MS),
          new Date(received.getTime() - MATCH_AFTER_EXPIRY_MS)],
      );

      if (cand.length === 0) return { outcome: "no_candidate" };

      if (cand.length > 1) {
        await c.query("UPDATE sms_inbox SET status = 'ambiguous' WHERE id = $1 AND status = 'unmatched'", [smsId]);
        const requestIds = cand.map((r) => r.id as string);
        const first = mapRow(cand[0]);
        after.run = () => safely("onAmbiguous", () => deps.alerts?.onAmbiguous?.({
          channelId, scope: first.scope, botId: first.botId, smsId, amountRial: amount, requestIds,
        }));
        return { outcome: "ambiguous", requestIds };
      }

      const target = mapRow(cand[0]);
      const effect = getEffect(target.scope, target.purpose);
      if (!effect) {
        after.run = () => safely("onProblem", () => deps.alerts?.onProblem?.({
          kind: "no_effect", channelId, scope: target.scope, botId: target.botId, smsId,
          requestId: target.id, message: `no payment effect registered for ${target.scope}:${target.purpose}`,
        }));
        return { outcome: "blocked", reason: "no_effect", requestId: target.id };
      }

      const confirmed = await confirmRequestTx(c, { requestId: target.id, by: "sms", smsId, now });
      if (!confirmed) return { outcome: "skipped", reason: "already_processed" };
      const promoted = await promoteQueue(c, channelId, { now, expiryMs: deps.expiryMs, randomInt: deps.randomInt });
      try {
        await effect(c, confirmed);
      } catch (err) {
        throw new EffectFailure(err, target.id);
      }
      after.run = () => safely("onConfirmed", () => deps.alerts?.onConfirmed?.({ request: confirmed, smsId, promoted }));
      return { outcome: "confirmed", request: confirmed, promoted };
    });
  } catch (err) {
    if (err instanceof SmsAlreadyConsumed) return { outcome: "skipped", reason: "already_processed" };
    if (err instanceof EffectFailure) {
      const cause = err.original instanceof Error ? err.original.message : String(err.original);
      const info = await lookupForAlert(pool, err.requestId);
      await safely("onProblem", () => deps.alerts?.onProblem?.({
        kind: "effect_failed", channelId, scope: info.scope, botId: info.botId, smsId,
        requestId: err.requestId, message: cause,
      }));
      return { outcome: "blocked", reason: "effect_failed", requestId: err.requestId };
    }
    throw err;
  }

  if (after.run) await after.run();
  return result;
}

async function lookupForAlert(pool: PoolLike, requestId: string): Promise<{ scope: "platform" | "bot"; botId: string | null }> {
  const c = await pool.connect();
  try {
    const { rows } = await c.query("SELECT scope, bot_id FROM payment_requests WHERE id = $1", [requestId]);
    return { scope: rows[0]?.scope ?? "platform", botId: rows[0]?.bot_id ?? null };
  } catch {
    return { scope: "platform", botId: null };
  } finally {
    c.release();
  }
}

/**
 * پس از ساختِ درخواستِ تازه صدا زده می‌شود: پیامک‌های unmatchedِ ۱۵ دقیقه‌ی اخیرِ
 * همان کانال/مبلغ را یک‌بار دوباره تست می‌کند (پیامکی که پیش از commitِ درخواست
 * رسیده یا دیر forward شده). با اولین تأیید متوقف می‌شود.
 */
export async function retestUnmatchedForRequest(
  pool: PoolLike,
  requestId: string,
  deps: MatchDeps = {},
): Promise<MatchOutcome[]> {
  const now = deps.now ?? new Date();
  const ids = await (async () => {
    const c = await pool.connect();
    try {
      const { rows } = await c.query(
        `SELECT s.id
           FROM payment_requests r
           JOIN sms_inbox s ON s.channel_id = r.channel_id
          WHERE r.id = $1 AND r.status IN ('pending', 'awaiting_review')
            AND s.status = 'unmatched' AND s.parsed_ok AND s.direction = 'deposit'
            AND s.amount_rial = r.final_amount_rial
            AND s.ingested_at >= $2
          ORDER BY s.received_at, s.id`,
        [requestId, new Date(now.getTime() - RETEST_WINDOW_MS)],
      );
      return rows.map((r) => r.id as string);
    } finally {
      c.release();
    }
  })();

  const outcomes: MatchOutcome[] = [];
  for (const id of ids) {
    const o = await matchSms(pool, id, deps);
    outcomes.push(o);
    if (o.outcome === "confirmed") break;
  }
  return outcomes;
}
