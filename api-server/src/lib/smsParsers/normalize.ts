/**
 * lib/smsParsers/normalize.ts — نرمال‌سازیِ متنِ پیامک پیش از هر regex.
 *
 * پیامکِ بانک‌ها ترکیبی از ارقامِ فارسی/عربی/لاتین، جداکننده‌ی هزارگانِ
 * لاتین (`,`) یا عربی (`٬`)، «ي/ك» عربی، نیم‌فاصله و کاراکترهای جهت‌دهیِ
 * نامرئی است. اگر هر regexی مستقیم روی متنِ خام اجرا شود، یک پیامکِ کاملاً
 * معتبر فقط به‌خاطر «۱٬۰۰۰٬۰۰۰» به‌جای «1,000,000» رد می‌شود.
 */
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

// ZWSP/ZWNJ/ZWJ، LRM/RLM/ALM، کاراکترهای embedding/isolate، BOM.
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g;

export function normalizeSmsText(raw: string): string {
  return String(raw ?? "")
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/٬/g, ",")                 // ٬ جداکننده‌ی هزارگانِ عربی
    .replace(/(?<=\d)،(?=\d)/g, ",")     // ، بینِ دو رقم
    .replace(/٫/g, ".")                 // ٫ ممیزِ عربی
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(INVISIBLE, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[  -   　\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** عددِ صحیحِ با جداکننده‌ی هزارگان (`1,000,000` یا `1000000`) — وگرنه null. */
export const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+)`;

export function toInt(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
