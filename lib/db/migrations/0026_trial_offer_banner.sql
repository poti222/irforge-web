-- 0026_trial_offer_banner.sql
-- First-visit trial offer banner — Phase 11 of identityverificationspec.md.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0025_plan_pricing.sql.)

ALTER TABLE users ADD COLUMN IF NOT EXISTS has_seen_trial_offer BOOLEAN NOT NULL DEFAULT false;
