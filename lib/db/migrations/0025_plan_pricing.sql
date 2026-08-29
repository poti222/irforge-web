-- 0025_plan_pricing.sql
-- Plan restructuring + live USD→IRR pricing — Phase 10 of
-- identityverificationspec.md.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0024_identity_fields.sql.)
--
-- See lib/db/src/schema/exchangeRates.ts and lib/db/src/schema/plans.ts for
-- what each column is for, and api-server/src/lib/exchangeRate.ts for the
-- conversion rule (`priceInToman()`) these feed into.

ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_usd REAL;

CREATE TABLE IF NOT EXISTS exchange_rates (
  id TEXT PRIMARY KEY,
  rial_per_usd REAL NOT NULL,
  source TEXT NOT NULL,
  updated_by TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Silver/Gold/Diamond seed and the exchange-rate bootstrap row are
-- idempotent, conditional inserts (ON CONFLICT / WHERE NOT EXISTS) — see
-- migrate.mjs's SQL string and postSteps() for the exact statements; not
-- duplicated here since drizzle-kit migrations aren't meant to carry
-- runtime-conditional seed logic.
