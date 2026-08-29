-- 0024_identity_fields.sql
-- Mandatory Profile Completion & Identity System — Phase 1.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0022_email_auth.sql /
-- 0023_sms_otp.sql.)
--
-- See lib/db/src/schema/users.ts for what each column is for, and
-- api-server/src/lib/profile.ts for the unified profile-completeness rule
-- these columns feed into (shared with the pre-existing purchase gate).

ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS flagged_for_review BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS flag_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_completed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_method TEXT;

-- Unique partial index on platform_username, same shape as the existing
-- users_phone_unique_idx (migration 0004). The duplicate-detection guard
-- that must run before this on real data lives in api-server/migrate.mjs's
-- postSteps() — a plain CREATE UNIQUE INDEX here would abort with an opaque
-- Postgres error instead of naming the colliding usernames.
CREATE UNIQUE INDEX IF NOT EXISTS users_platform_username_unique_idx
  ON users(platform_username) WHERE platform_username IS NOT NULL;
