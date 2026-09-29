/**
 * lib/paymentDecisions.ts — تصمیمِ دستیِ ادمین روی یک درخواستِ پرداخت
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۶): تأیید یا رد.
 *
 *  - **اولین تصمیم برنده است.** تأیید و رد هر دو با `UPDATE … WHERE status IN ('pending',
 *    'awaiting_review')` انجام می‌شوند و زیرِ lockِ کانال + قفلِ ردیف؛ پس اگر دو ادمین (یا یک
 *    ادمین و یک پیامکِ بانک) هم‌زمان تصمیم بگیرند فقط یکی اثر می‌گذارد و دیگری `decided:false`
 *    همراه با وضعیتِ فعلی (و اینکه چه کسی تصمیم گرفته) می‌گیرد.
 *  - تأیید از **همان تابعِ تأییدِ فاز ۴** (`confirmRequestTx`) می‌گذرد و همان effectِ ثبت‌شده را
 *    (در همان تراکنش) اجرا می‌کند؛ effectِ ثبت‌نشده → fail-closed (`no_effect`) و چیزی عوض نمی‌شود.
 *  - رد: `rejected` + ادمین/دلیل/زمان؛ اگر اسلاتی آزاد شد نفرِ بعدیِ صف در همان تراکنش ارتقا می‌یابد.
 *  - ترتیبِ قفل مثلِ همه‌جا: قفلِ کانال ← ردیف.
 *
 * احرازِ هویتِ ادمین اینجا **نیست**: مین‌بات (که secret را دارد) پیش از صدا زدن مجوزِ ادمین را در
 * خودِ بات می‌سنجد و شناسه‌ی او را برایِ ثبتِ ردپا می‌فرستد.
 */
import { getPaymentEffect, type PaymentEffect } from "./paymentEffects";
import { confirmRequestTx } from "./paymentMatcher";
import {
  mapRow, PaymentRequestError, promoteQueue, withChannelLock,
  type PaymentRequestRow, type PoolLike,
} from "./paymentRequests";

export type AdminDecision = "approve" | "reject";
export const MAX_REJECT_REASON = 500;

export interface DecisionResult {
  /** true فقط برایِ تماسی که واقعاً وضعیت را عوض کرد. */
  decided: boolean;
  /** وضعیتِ فعلیِ ردیف پس از این تماس (برایِ decided=false: تصمیمِ قبلی). */
  request: PaymentRequestRow & { rejectedByAdminId: string | null; rejectReason: string | null };
  /** درخواست‌هایی که با آزاد شدنِ اسلات از صف ارتقا یافتند. */
  promoted: PaymentRequestRow[];
}

function withRejectFields(row: any): DecisionResult["request"] {
  return { ...mapRow(row), rejectedByAdminId: row.rejected_by_admin_id ?? null, rejectReason: row.reject_reason ?? null };
}

export async function decideRequestByAdmin(
  pool: PoolLike,
  input: {
    requestId: string;
    decision: AdminDecision;
    adminId: string;
    reason?: string | null;
    now?: Date;
    getEffect?: (scope: string, purpose: string) => PaymentEffect | undefined;
    expiryMs?: number;
    randomInt?: (n: number) => number;
  },
): Promise<DecisionResult> {
  const now = input.now ?? new Date();
  const adminId = String(input.adminId ?? "").trim();
  if (!adminId) throw new PaymentRequestError("adminId لازم است.", "invalid_admin");
  const reason = String(input.reason ?? "").trim().slice(0, MAX_REJECT_REASON) || null;
  const getEffect = input.getEffect ?? getPaymentEffect;

  // پیش‌خوانی (بدونِ قفل) فقط برایِ دانستنِ کانال؛ همه‌ی تصمیم‌ها زیرِ قفل گرفته می‌شوند.
  const channelId = await (async () => {
    const c = await pool.connect();
    try {
      const { rows } = await c.query("SELECT channel_id FROM payment_requests WHERE id = $1", [input.requestId]);
      return rows[0]?.channel_id as string | undefined;
    } finally {
      c.release();
    }
  })();
  if (!channelId) throw new PaymentRequestError("درخواست پیدا نشد.", "not_found");

  return withChannelLock(pool, channelId, async (c): Promise<DecisionResult> => {
    const { rows: cur } = await c.query("SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE", [input.requestId]);
    const row = cur[0];
    if (!row) throw new PaymentRequestError("درخواست پیدا نشد.", "not_found");
    if (row.status !== "pending" && row.status !== "awaiting_review") {
      return { decided: false, request: withRejectFields(row), promoted: [] };
    }

    if (input.decision === "approve") {
      const effect = getEffect(row.scope, row.purpose);
      if (!effect) {
        throw new PaymentRequestError(`برای ${row.scope}:${row.purpose} مسیرِ تأیید تنظیم نشده.`, "no_effect");
      }
      const confirmed = await confirmRequestTx(c, { requestId: row.id, by: "admin", adminId, now });
      if (!confirmed) return { decided: false, request: withRejectFields(row), promoted: [] };
      const promoted = await promoteQueue(c, channelId, { now, expiryMs: input.expiryMs, randomInt: input.randomInt });
      await effect(c, confirmed);
      const { rows: fresh } = await c.query("SELECT * FROM payment_requests WHERE id = $1", [row.id]);
      return { decided: true, request: withRejectFields(fresh[0]), promoted };
    }

    const { rows } = await c.query(
      `UPDATE payment_requests
          SET status = 'rejected', queue_position = NULL,
              rejected_by_admin_id = $2, reject_reason = $3, rejected_at = $4
        WHERE id = $1 AND status IN ('pending', 'awaiting_review')
        RETURNING *`,
      [row.id, adminId, reason, now]);
    if (!rows[0]) return { decided: false, request: withRejectFields(row), promoted: [] };
    const promoted = await promoteQueue(c, channelId, { now, expiryMs: input.expiryMs, randomInt: input.randomInt });
    return { decided: true, request: withRejectFields(rows[0]), promoted };
  });
}
