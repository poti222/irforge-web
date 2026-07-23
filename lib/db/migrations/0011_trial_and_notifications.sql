-- 0011_trial_and_notifications.sql
-- تریال ۷ روزه (پکیج نقره‌ای رایگان برای یک‌بار) + سیستم اعلان‌های جدید سایت.

ALTER TABLE users ADD COLUMN IF NOT EXISTS has_used_trial boolean NOT NULL DEFAULT false;

ALTER TABLE bots ADD COLUMN IF NOT EXISTS is_trial boolean NOT NULL DEFAULT false;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS trial_expires_at timestamptz;

CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  bot_id text,
  type text NOT NULL,               -- trial_warning | trial_expired | ... (future types)
  severity text NOT NULL DEFAULT 'info', -- info | warning | critical
  title text NOT NULL,
  message text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  -- کلید یکتا برای جلوگیری از تکرار هر اعلان (مثلاً یک هشدار در روز، بدون cron):
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx
  ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
