import type { Lang } from "@/hooks/use-language";

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
