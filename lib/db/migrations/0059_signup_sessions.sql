-- 0059_signup_sessions.sql
-- Runtime migration lives in api-server/migrate.mjs; this mirrors it for drizzle-kit parity.

-- ─── ثبت‌نام یک‌صفحه‌ای (/auth/signup/*) ─────────────────────────────────────
-- نشستِ کوتاه‌عمرِ ثبت‌نام: شماره (پیامک)، تلگرام (بات) و ایمیل (اختیاری) هر
-- کدام جدا و سمتِ سرور تأیید می‌شوند. کلاینت هرگز «تأییدشده» بودن را اعلام نمی‌کند.
CREATE TABLE IF NOT EXISTS signup_sessions (
  id TEXT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  gender TEXT,
  platform_username TEXT,
  locale TEXT,
  phone TEXT,
  phone_code_hash TEXT,
  phone_code_expires_at TIMESTAMPTZ,
  phone_code_attempts INTEGER NOT NULL DEFAULT 0,
  phone_code_sent_count INTEGER NOT NULL DEFAULT 0,
  phone_verified_at TIMESTAMPTZ,
  email_code_hash TEXT,
  email_code_expires_at TIMESTAMPTZ,
  email_code_attempts INTEGER NOT NULL DEFAULT 0,
  email_code_sent_count INTEGER NOT NULL DEFAULT 0,
  email_verified_at TIMESTAMPTZ,
  email_verified_for TEXT,
  telegram_id TEXT,
  telegram_chat_id TEXT,
  telegram_username TEXT,
  telegram_first_name TEXT,
  telegram_last_name TEXT,
  telegram_photo_file_id TEXT,
  telegram_verified_at TIMESTAMPTZ,
  resume_hash TEXT,
  resume_expires_at TIMESTAMPTZ,
  source_ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS signup_sessions_expires_idx ON signup_sessions(expires_at);
CREATE INDEX IF NOT EXISTS signup_sessions_telegram_idx ON signup_sessions(telegram_id);
