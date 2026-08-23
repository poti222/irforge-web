-- 0022_email_auth.sql
-- IRFORGE_PROMPT_V3 Phase 14 — real, code-verified email registration/login.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0017_auth_guest_admin.sql.)

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE pending_registrations ADD COLUMN IF NOT EXISTS registration_method TEXT NOT NULL DEFAULT 'phone';
