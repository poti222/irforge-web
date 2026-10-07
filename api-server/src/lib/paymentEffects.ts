/**
 * lib/paymentEffects.ts — اثرِ کسب‌وکاریِ تأییدِ پرداخت
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۴).
 *
 * موتورِ تطبیق (`paymentMatcher.ts`) فقط «درخواست را تأیید می‌کند»؛ اینکه تأیید
 * چه چیزی را عوض کند (شارژِ کیف‌پولِ پلتفرم، تأییدِ سفارشِ یک بات، …) به‌ازای
 * `(scope, purpose)` اینجا ثبت می‌شود. فازهای ۵ و ۸ effectهایشان را ثبت می‌کنند.
 *
 * قرارداد:
 *  - effect **داخلِ همان تراکنشِ تأیید** اجرا می‌شود (با همان `client`): اگر throw کند
 *    کلِ تأیید rollback می‌شود (درخواست pending می‌ماند، پیامک unmatched).
 *  - effectی که نمی‌تواند از `client` استفاده کند (مثلاً drizzle روی اتصالِ دیگر)
 *    **باید** با `request.id` به‌عنوانِ مرجع idempotent باشد؛ چون ممکن است بعد از
 *    اجرای effect و پیش از commit پروسه بمیرد و تأیید دوباره تلاش شود.
 *  - **fail-closed**: برای `(scope, purpose)`ی که effect ثبت نشده، موتور هرگز تأیید
 *    نمی‌کند (پولِ گرفته‌شده و اثرِ اجرانشده بدترین حالت است). effectِ «فقط تغییرِ
 *    وضعیت» (مثلاً وقتی بات وضعیت را poll می‌کند) باید صریحاً ثبت شود.
 */
import type { ClientLike, PaymentRequestRow } from "./paymentRequests";

export type PaymentEffect = (c: ClientLike, request: PaymentRequestRow) => Promise<void>;

const registry = new Map<string, PaymentEffect>();
const keyOf = (scope: string, purpose: string) => `${scope}:${purpose}`;

export function registerPaymentEffect(scope: "platform" | "bot", purpose: "wallet_topup" | "order" | "school_wallet_topup", effect: PaymentEffect): void {
  const key = keyOf(scope, purpose);
  const existing = registry.get(key);
  if (existing && existing !== effect) {
    throw new Error(`payment effect already registered for ${key}`);
  }
  registry.set(key, effect);
}

export function getPaymentEffect(scope: string, purpose: string): PaymentEffect | undefined {
  return registry.get(keyOf(scope, purpose));
}

/** فقط برای تست. */
export function clearPaymentEffects(): void {
  registry.clear();
}
