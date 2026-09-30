-- 0036_schools_phase7_bots.sql
-- بخش "/schools" فاز ۷: استخرِ توکنِ بات، باتِ اطلاع‌رسانیِ هر مدرسه، اتصالِ
-- تلگرام، و ستونِ schoolId روی notifications.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0029..0035.)

CREATE TABLE IF NOT EXISTS school_bot_token_pool (
  id TEXT PRIMARY KEY,
  bot_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  assigned_school_id TEXT REFERENCES schools(id),
  added_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS school_bots (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL UNIQUE REFERENCES schools(id),
  bot_token_pool_id TEXT NOT NULL REFERENCES school_bot_token_pool(id),
  telegram_bot_id TEXT,
  telegram_username TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS school_bot_subscribers (
  id TEXT PRIMARY KEY,
  school_bot_id TEXT NOT NULL REFERENCES school_bots(id),
  user_id TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS school_bot_subscribers_uniq_idx ON school_bot_subscribers(school_bot_id, user_id);

CREATE TABLE IF NOT EXISTS school_bot_link_tokens (
  token TEXT PRIMARY KEY,
  school_bot_id TEXT NOT NULL REFERENCES school_bots(id),
  user_id TEXT NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS school_id TEXT;
CREATE INDEX IF NOT EXISTS idx_notifications_school ON notifications(school_id);
