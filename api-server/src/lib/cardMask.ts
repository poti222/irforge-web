/**
 * lib/cardMask.ts — ماسک/اعتبارسنجیِ شماره‌کارت (IRFORGE_CARD_AUTOCONFIRM_PROMPT،
 * قاعده‌ی سراسری: شماره‌کارت در لاگ‌ها ماسک شود، `6037-****-****-1234`).
 */

/** فقط ارقام (ارقامِ فارسی/عربی هم نرمال می‌شوند). */
export function digitsOnly(input: string): string {
  return String(input ?? "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\D/g, "");
}

/** `6037-****-****-1234` — هرگز کلِ شماره را برنمی‌گرداند. ورودیِ نامعتبر → `****`. */
export function maskCardNumber(card: string | null | undefined): string {
  const d = digitsOnly(card ?? "");
  if (d.length !== 16) return "****";
  return `${d.slice(0, 4)}-****-****-${d.slice(12)}`;
}

/** نمایشِ خوانا برایِ خودِ کاربرِ پرداخت‌کننده: `6037-9912-3456-7890`. */
export function formatCardNumber(card: string): string {
  const d = digitsOnly(card);
  return d.length === 16 ? d.replace(/(\d{4})(?=\d)/g, "$1-") : d;
}

/** الگوریتمِ Luhn — شماره‌کارتِ ۱۶رقمیِ بانک‌های ایران هم از آن پیروی می‌کند. */
export function isValidCardNumber(card: string): boolean {
  const d = digitsOnly(card);
  if (d.length !== 16 || /^(\d)\1+$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    let n = Number(d[15 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}
