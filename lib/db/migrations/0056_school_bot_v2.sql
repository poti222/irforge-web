-- 0056_school_bot_v2.sql
-- Runtime migration lives in api-server/migrate.mjs; this mirrors it for drizzle-kit parity.

-- ─── باتِ مدرسه: عکس/وضعیتِ همگام‌سازی، دسترس‌ناپذیری، وضعیتِ گفتگو، والدِ فقط-تلگرام؛ مایگریشنِ ۰۰۵۶ همین را تکرار می‌کند ───
ALTER TABLE school_bots ADD COLUMN IF NOT EXISTS photo_jpeg_image_id TEXT;
ALTER TABLE school_bots ADD COLUMN IF NOT EXISTS photo_jpeg_source_url TEXT;
ALTER TABLE school_bots ADD COLUMN IF NOT EXISTS photo_synced_url TEXT;
ALTER TABLE school_bots ADD COLUMN IF NOT EXISTS photo_status TEXT;
ALTER TABLE school_bots ADD COLUMN IF NOT EXISTS last_resync_at TIMESTAMPTZ;
ALTER TABLE school_bot_subscribers ADD COLUMN IF NOT EXISTS telegram_user_id TEXT;
ALTER TABLE school_bot_subscribers ADD COLUMN IF NOT EXISTS unreachable_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS school_bot_chat_state (
  school_bot_id TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  state TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_bot_id, telegram_chat_id)
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_telegram_only BOOLEAN NOT NULL DEFAULT false;
