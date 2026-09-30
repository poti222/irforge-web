/**
 * lib/topupCountdown.ts — شمارشگر معکوسِ «بررسیِ خودکار» بعد از ارسالِ فیش (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۵/۸).
 *
 * بعد از آپلودِ فیش، ۵ دقیقه شمارشِ معکوس نشان می‌دهیم («در حال بررسیِ خودکار»)؛ اگر در این مدت پیامکِ بانک برسد،
 * تأییدِ خودکار همچنان کار می‌کند و صفحه با پیامِ موفقیت جایگزین می‌شود (poll). بعد از ۵ دقیقه: «در حال بررسیِ دستی است».
 * (همان رفتارِ بات: `services/card_pay_view.py`.) تابعِ خالص تا قابلِ تست باشد.
 */
export const RECEIPT_COUNTDOWN_SECONDS = 5 * 60;

export type ReceiptReviewPhase =
  | { phase: "auto"; secondsLeft: number }   // ۵ دقیقه‌ی اول: منتظرِ پیامکِ بانک
  | { phase: "manual" };                     // بعد از آن: بررسیِ دستیِ ادمین

/** `receiptUploadedAt` = ISO از سرور؛ نامعتبر/خالی → مستقیم «دستی» (ایمن‌ترین پیام: هیچ وعده‌ی خودکاری نمی‌دهد). */
export function receiptReviewPhase(receiptUploadedAt: string | null | undefined, nowMs: number): ReceiptReviewPhase {
  const t = receiptUploadedAt ? new Date(receiptUploadedAt).getTime() : NaN;
  if (!Number.isFinite(t)) return { phase: "manual" };
  const left = Math.ceil((t + RECEIPT_COUNTDOWN_SECONDS * 1000 - nowMs) / 1000);
  return left > 0 ? { phase: "auto", secondsLeft: Math.min(left, RECEIPT_COUNTDOWN_SECONDS) } : { phase: "manual" };
}
