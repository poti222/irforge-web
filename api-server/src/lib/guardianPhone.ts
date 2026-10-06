import { toLatinDigits } from "./persianDigits";

/**
 * شماره‌یِ وارد‌شده‌یِ والد → E.164 با همان قالبی که `users.phone` ذخیره می‌شود (`+98912…`، lib/otp.ts normalizePhone).
 * تفاوت با normalizePhone: ارقامِ فارسی/عربی، پیشوندِ 0098، و اعتبارسنجیِ طولِ موبایلِ ایران را هم می‌فهمد
 * (normalizePhone برایِ «0098912…» شمارهِ غلط می‌ساخت چون صفرِ ابتدایی را به 98 تبدیل می‌کند). نامعتبر → null.
 */
export function normalizeGuardianPhone(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 40) return null;
  let s = toLatinDigits(raw).replace(/[\s\-().‌‏‎]/g, "");
  const plus = s.startsWith("+");
  s = s.replace(/\D/g, "");
  if (!s) return null;
  if (!plus && s.startsWith("00")) s = s.slice(2); // 0098… / 00971…
  else if (!plus && s.startsWith("0")) s = "98" + s.slice(1); // 0912… (محلیِ ایران)
  else if (!plus && !s.startsWith("98") && /^9\d{9}$/.test(s)) s = "98" + s; // 912… بدونِ صفر
  if (s.startsWith("98")) {
    // موبایلِ ایران: 98 + 9xxxxxxxxx (۱۰ رقم)
    if (!/^989\d{9}$/.test(s)) return null;
    return "+" + s;
  }
  if (s.length < 8 || s.length > 15) return null;
  return "+" + s;
}

/** نمایشِ ماسک‌شده: +98912***4567 → 0912***4567 (فقط برایِ والدی که خودش شماره را وارد کرده). */
export function maskPhone(e164: string): string {
  const local = e164.startsWith("+98") ? "0" + e164.slice(3) : e164;
  return local.length > 7 ? `${local.slice(0, 4)}***${local.slice(-4)}` : local;
}

/** فرم‌هایی که در users.phone ممکن است ذخیره شده باشد (قدیمی‌ها بدونِ نرمال‌سازی). */
export function phoneVariants(e164: string): string[] {
  const out = new Set([e164]);
  if (e164.startsWith("+98")) {
    out.add("0" + e164.slice(3));
    out.add(e164.slice(1));
    out.add(e164.slice(3));
  }
  return [...out];
}
