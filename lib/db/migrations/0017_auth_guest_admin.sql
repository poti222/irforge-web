-- 0017_auth_guest_admin.sql
-- ثبت‌نام/ورود دومرحله‌ای، محدودسازی نرخ، نشست مهمان، لاگ ممیزی ادمین.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0016_site_updates.sql.)

-- ─── USERS ─────────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false;

-- شماره از اینجا به بعد شناسه‌ی ورود است، پس باید یکتا باشد.
-- ایندکس **جزئی** است چون ردیف‌های قدیمی ممکن است شماره نداشته باشند.
-- اگر شماره‌ی تکراری واقعی وجود داشته باشد این دستور با خطا متوقف می‌شود و
-- هیچ ردیفی حذف نمی‌شود — پاک‌سازی باید آگاهانه و دستی انجام شود.
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique_idx
  ON users(phone) WHERE phone IS NOT NULL;

-- ─── PENDING_REGISTRATIONS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pending_registrations (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  telegram_id TEXT,
  telegram_chat_id TEXT,
  telegram_username TEXT,
  telegram_first_name TEXT,
  telegram_last_name TEXT,
  telegram_photo_file_id TEXT,
  code_hash TEXT,
  code_expires_at TIMESTAMPTZ,
  code_attempts INTEGER NOT NULL DEFAULT 0,
  code_sent_count INTEGER NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,
  step TEXT NOT NULL DEFAULT 'identity',
  locale TEXT,
  source_ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS pending_registrations_step_idx
  ON pending_registrations(step, created_at DESC);
CREATE INDEX IF NOT EXISTS pending_registrations_expires_idx
  ON pending_registrations(expires_at);
CREATE INDEX IF NOT EXISTS pending_registrations_telegram_idx
  ON pending_registrations(telegram_id);

-- ─── LOGIN_CHALLENGES ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS login_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  code_expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS login_challenges_user_idx ON login_challenges(user_id);
CREATE INDEX IF NOT EXISTS login_challenges_expires_idx ON login_challenges(code_expires_at);

-- ─── TELEGRAM_LINK_TOKENS ──────────────────────────────────────────────────
ALTER TABLE telegram_link_tokens ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'link';
ALTER TABLE telegram_link_tokens ADD COLUMN IF NOT EXISTS pending_registration_id TEXT;
ALTER TABLE telegram_link_tokens ALTER COLUMN user_id DROP NOT NULL;

-- دقیقاً یکی از user_id / pending_registration_id باید ست باشد.
DO $$ BEGIN
  ALTER TABLE telegram_link_tokens ADD CONSTRAINT telegram_link_tokens_owner_chk
    CHECK ((user_id IS NOT NULL) <> (pending_registration_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── AUTH_RATE_LIMITS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked_until TIMESTAMPTZ
);

-- ─── GUEST_SESSIONS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guest_sessions (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  locale TEXT,
  converted_user_id TEXT
);
CREATE INDEX IF NOT EXISTS guest_sessions_expires_idx ON guest_sessions(expires_at);

-- ─── ADMIN_AUDIT_LOG ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  reason TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx
  ON admin_audit_log(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_actor_idx
  ON admin_audit_log(actor_user_id, created_at DESC);
