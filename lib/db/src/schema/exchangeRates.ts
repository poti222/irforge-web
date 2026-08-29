import { pgTable, text, timestamp, real } from "drizzle-orm/pg-core";

/**
 * exchange_rates — Phase 10 of identityverificationspec.md: the real,
 * billing-authoritative USD→Rial rate.
 *
 * Deliberately separate from `platform_settings`'s `currency_display`
 * (Phase 39, see config/currency.ts on the frontend): that one is a
 * display-only "≈ X USD" label shown next to a Toman price that is never
 * actually charged in USD. This table is different — it's what a
 * live-priced plan (`plans.price_usd`) is converted through at the moment
 * of checkout/renewal, so it must never be reused for the display-only
 * purpose or vice versa.
 *
 * Append-only history rather than a single row: every automatic refresh and
 * every manual override inserts a new row instead of updating one, so
 * "what rate was actually in effect when this charge happened" stays
 * reconstructable, and an admin can see when the automatic sync last
 * succeeded (the newest row's `fetchedAt` age is the staleness signal).
 */
export const exchangeRatesTable = pgTable("exchange_rates", {
  id: text("id").primaryKey(),
  /** Iranian Rial per 1 USD — not Toman (1 Toman = 10 Rial). */
  rialPerUsd: real("rial_per_usd").notNull(),
  /** "api" for an automatic sync, "manual" for an admin override. */
  source: text("source").notNull(),
  /** Admin user id for a manual override; null for an automatic fetch. */
  updatedBy: text("updated_by"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ExchangeRate = typeof exchangeRatesTable.$inferSelect;
