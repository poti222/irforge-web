/**
 * lib/currency.ts — IRFORGE_RIAL_MIGRATION Phase 2.
 * ─────────────────────────────────────────────────────────────────────────────
 * The canonical money unit at the DB layer (wallets.balance,
 * wallet_transactions.amount, wallet_topups.*, payments.amount, plans.price,
 * marketplace_items.price) is now Rial, an integer — the unit the bank's SMS
 * deposit confirmations and Blubank's own input field actually use. Toman
 * (1 Toman = 10 Rial) stays the unit everything human-facing shows: every
 * hardcoded price table (pluginPricing.ts, wallet-topup presets), every admin
 * input field, and the entire JSON API surface to the frontend keep working
 * in Toman exactly as before this migration — `formatToman()` and its ~40
 * call sites in irforge/src are untouched. Conversion happens only at the two
 * boundaries: `tomanToRial()` right before a value reaches one of the Rial
 * columns above (or a Rial-native function like `deductWallet`/`creditWallet`),
 * `rialToToman()` right before a value leaves the API as JSON or lands in a
 * `formatTomanFa()` notification string.
 *
 * The one path that must NOT round-trip through Toman is the Blubank SMS
 * pipeline (`walletTopupService.ts`'s `parseBlubankDepositSms()` and the
 * `wallet_topups.finalAmount` it's matched against) — that's the whole point
 * of this migration: the bank sends Rial, so keeping it in Rial end-to-end
 * (instead of the old `Math.round(amountRial / 10)`) is what makes the exact
 * equality match in `routes/walletTopupSmsWebhook.ts` reliable for
 * non-round amounts.
 */

export type Toman = number;
export type Rial = number;

export function tomanToRial(toman: number): Rial {
  return Math.round(toman) * 10;
}

export function rialToToman(rial: number): Toman {
  return Math.round(rial / 10);
}

/**
 * Sanity bounds for `exchange_rates.rial_per_usd` — shared by the manual
 * exchange-rate override endpoint (`routes/exchangeRate.ts`) and the
 * migration's own pre-flight guard (`migrate.mjs`), so both use the exact
 * same definition of "looks Toman-scale, not Rial-scale".
 *
 * Real Rial-per-USD in 2026 sits in the high hundred-thousands to low
 * millions (Toman/USD * 10). A value an admin fat-fingered in as a
 * colloquial Toman rate (tens of thousands to low hundred-thousands) falls
 * below `MIN_PLAUSIBLE_RIAL_PER_USD`; a value with extra stray zeros falls
 * above `MAX_PLAUSIBLE_RIAL_PER_USD`. These are deliberately wide (a decade
 * of Iran's real depreciation trend on either side of "today"), not a tight
 * live-rate check — the goal is catching an obvious unit mistake, not
 * validating the rate itself.
 */
export const MIN_PLAUSIBLE_RIAL_PER_USD = 100_000;
export const MAX_PLAUSIBLE_RIAL_PER_USD = 100_000_000;

export function isPlausibleRialPerUsd(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= MIN_PLAUSIBLE_RIAL_PER_USD &&
    value <= MAX_PLAUSIBLE_RIAL_PER_USD
  );
}
