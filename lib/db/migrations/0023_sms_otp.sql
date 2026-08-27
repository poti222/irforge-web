-- 0023_sms_otp.sql
-- IRFORGE_SMS_OTP_PROMPT Phase 2 — OTP codes delivered over sms.ir Verify,
-- shared by all three purposes (register/login/password_reset).
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0022_email_auth.sql.)

CREATE TABLE IF NOT EXISTS sms_otp_codes (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  purpose TEXT NOT NULL,
  user_id TEXT,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 1,
  consumed_at TIMESTAMPTZ,
  source_ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sms_otp_codes_phone_purpose_idx
  ON sms_otp_codes(phone, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS sms_otp_codes_source_ip_idx
  ON sms_otp_codes(source_ip, created_at DESC);
CREATE INDEX IF NOT EXISTS sms_otp_codes_expires_idx ON sms_otp_codes(expires_at);
