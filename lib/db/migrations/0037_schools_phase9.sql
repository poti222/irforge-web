-- 0037_schools_phase9.sql
-- بخش "/schools" فاز ۹: وضعیتِ خوانده‌شدنِ رشته‌ها، انقضا/سقفِ مصرفِ کدِ معرف،
-- و لاگِ رخدادهایِ مدیریتی.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0029..0036.)

CREATE TABLE IF NOT EXISTS school_message_read_state (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  thread_key TEXT NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS school_message_read_state_uniq_idx ON school_message_read_state(user_id, thread_key);

ALTER TABLE school_invite_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE school_invite_codes ADD COLUMN IF NOT EXISTS max_uses INTEGER;
ALTER TABLE school_invite_codes ADD COLUMN IF NOT EXISTS uses_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS school_audit_log (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_audit_log_school ON school_audit_log(school_id, created_at DESC);
