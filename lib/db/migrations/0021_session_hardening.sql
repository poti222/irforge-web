-- 0021_session_hardening.sql
-- IRFORGE_PROMPT_V3 Phase 6.2 — session token hashing + activity groundwork.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0017_auth_guest_admin.sql.)
--
-- No column rename: `sessions.token` keeps its name but now holds
-- sha256(token) rather than the raw token — every app-level read/write of
-- that column goes through lib/sessionToken.ts. This one-time deploy
-- invalidates every session that predates it (their stored value no longer
-- matches anything the app will hash again); that's expected, same as a
-- forced password reset.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent_hash TEXT;
