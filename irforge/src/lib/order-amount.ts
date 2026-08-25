/**
 * lib/order-amount.ts — IRFORGE_PROMPT_V3 Phase 51
 *
 * An order's amount comes straight from the bot's own sheet (see
 * OrdersSection.tsx / botOrders.ts) as `unknown` — grouping it as a number is
 * only safe when it actually is one. A non-numeric or missing amount falls
 * back to the raw value, labeled with whatever currency the bot's own
 * settings use (a bot configured for USD has USD amounts here, not Toman).
 */
export function formatOrderAmount(value: unknown, currency: string, lang: string): string {
  if (value == null || value === "" || String(value).trim() === "") return "—";
  const n = Number(value);
  const grouped = Number.isFinite(n) ? n.toLocaleString(lang === "fa" ? "fa-IR" : "en-US") : String(value);
  return currency ? `${grouped} ${currency}` : grouped;
}
