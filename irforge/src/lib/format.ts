import type { Lang } from "@/hooks/use-language";
import type { CurrencyRate } from "@/config/currency";

/**
 * Shared price formatter (P3).
 *
 * The product sells in Iranian Toman, not dollars. Every rendered price must
 * go through this one helper instead of ad-hoc `$${x}` templates so currency,
 * digit shaping and the thousands separator stay consistent everywhere.
 *
 * fa → Persian digits + "تومان"  (e.g. ۱۲۰٬۰۰۰ تومان)
 * en → Latin digits  + "Toman"   (e.g. 120,000 Toman)
 */
export function formatToman(
  amount: number | string | null | undefined,
  lang: Lang = "fa"
): string {
  const raw = typeof amount === "string" ? Number(amount) : amount;
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : 0;
  const locale = lang === "fa" ? "fa-IR" : "en-US";
  const suffix = lang === "fa" ? "تومان" : "Toman";
  return `${n.toLocaleString(locale)} ${suffix}`;
}

/**
 * Converts a Toman amount into `rate`'s currency (P39). Display-only — never
 * feed this into a charge; the wallet and every purchase endpoint still work
 * in Toman exclusively.
 */
export function convertFromToman(amountToman: number, rate: CurrencyRate): number {
  if (!Number.isFinite(amountToman) || !rate.tomanPerUnit) return 0;
  return amountToman / rate.tomanPerUnit;
}

/**
 * The "≈ 12.34 USD" line shown next to a `formatToman` price once the visitor
 * has picked a display currency. Returns null (render nothing) when no rate
 * is active — Toman-only stays the default, and this never invents a number.
 */
export function formatConvertedAmount(
  amountToman: number | string | null | undefined,
  rate: CurrencyRate | null | undefined,
  lang: Lang = "fa"
): string | null {
  if (!rate) return null;
  const raw = typeof amountToman === "string" ? Number(amountToman) : amountToman;
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  const locale = lang === "fa" ? "fa-IR" : "en-US";
  const converted = convertFromToman(n, rate);
  const formatted = converted.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `≈ ${formatted} ${rate.code}`;
}
