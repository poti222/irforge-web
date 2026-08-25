/**
 * config/currency.ts — IRFORGE_PROMPT_V3 Phase 39.
 * ─────────────────────────────────────────────────────────────────────────────
 * Mirrors config/support.ts's shape: types + a query-key constant + a
 * `useCurrencyDisplay()` hook reading the super-admin-editable
 * `currency_display` platform setting (api-server/src/lib/platformSettings.ts).
 *
 * Toman stays the one real, transactional currency everywhere in the product
 * (wallet, invoices, plan prices are all stored and charged in Toman). These
 * rates are a DISPLAY-ONLY convenience — "≈ X USD" next to the real Toman
 * price — never a second currency an amount is actually billed in.
 */
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export interface CurrencyRate {
  code: string;
  label: string;
  /** How many Toman equal one unit of `code`. */
  tomanPerUnit: number;
}

export interface CurrencyDisplaySettings {
  rates: CurrencyRate[];
}

export const DEFAULT_CURRENCY_DISPLAY: CurrencyDisplaySettings = { rates: [] };

export const CURRENCY_DISPLAY_QUERY_KEY = ["currency-display"] as const;

/**
 * The live list of extra currencies to offer alongside Toman. Empty until a
 * super admin configures at least one rate (or the server auto-derives a USD
 * rate from the existing USDT payment-method rate) — an empty list means
 * "Toman only", which is also the correct fallback while this is loading.
 */
export function useCurrencyDisplay(): CurrencyDisplaySettings {
  const { data } = useQuery({
    queryKey: CURRENCY_DISPLAY_QUERY_KEY,
    queryFn: () => customFetch<CurrencyDisplaySettings>("/api/currency-display"),
    initialData: DEFAULT_CURRENCY_DISPLAY,
    staleTime: 5 * 60 * 1000,
  });
  return data;
}
