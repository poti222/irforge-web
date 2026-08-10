/**
 * lib/discounts.ts
 * Phase 9 — یک محل واحد برای ریاضیات محاسبه‌ی تخفیف، تا هم
 * POST /api/discounts/validate و هم مسیر خرید (Phase 11،
 * POST /bots/wallet-purchase) دقیقاً یک نتیجه بدهند.
 *
 * قوانین:
 *  - تخفیف درصدی به سمت پایین به نزدیک‌ترین تومان گرد می‌شود (Math.floor)،
 *    نه round — تا هرگز چیزی بیشتر از درصد واقعی کسر نشود.
 *  - مبلغ نهایی هرگز منفی نمی‌شود؛ کف آن صفر است.
 *  - یک تخفیف ثابت (fixed) بزرگ‌تر از مبلغ سفارش، سفارش را صفر می‌کند،
 *    نه اینکه اعتبار/باقیمانده تولید کند.
 */

export type DiscountKind = "percent" | "fixed";

export interface DiscountComputation {
  /** مبلغ اصلی سفارش (تومان) */
  orderAmount: number;
  /** مبلغ کسرشده (تومان) — همیشه <= orderAmount */
  discountAmount: number;
  /** مبلغ نهایی قابل‌پرداخت (تومان) — همیشه >= 0 */
  finalAmount: number;
}

/**
 * محاسبه‌ی مبلغ تخفیف و مبلغ نهایی برای یک کد معتبر (بدون چک‌کردن
 * فعال‌بودن/انقضا/سقف استفاده — آن‌ها مسئولیت فراخوان هستند).
 */
export function computeDiscount(
  kind: DiscountKind,
  value: number,
  orderAmount: number,
): DiscountComputation {
  const amount = Math.max(0, Math.round(orderAmount));
  let discountAmount: number;

  if (kind === "percent") {
    // گرد به پایین: تخفیف هرگز بیشتر از درصد واقعی نمی‌شود.
    discountAmount = Math.floor((amount * value) / 100);
  } else {
    discountAmount = Math.round(value);
  }

  // کلمپ: تخفیف نمی‌تواند بیشتر از خودِ مبلغ سفارش باشد (سفارش صفر می‌شود،
  // نه منفی/اعتبار).
  discountAmount = Math.min(Math.max(0, discountAmount), amount);
  const finalAmount = Math.max(0, amount - discountAmount);

  return { orderAmount: amount, discountAmount, finalAmount };
}
