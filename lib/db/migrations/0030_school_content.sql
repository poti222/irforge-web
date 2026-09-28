-- 0030_school_content.sql
-- بخش "/schools" فاز ۱: محتوای لغت‌نامه/جزوه/کتاب/فرمول (CRUD واقعی روی
-- Postgres، نه پورتِ Google Sheetsِ ریپوی dars).
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0029.)

CREATE TABLE IF NOT EXISTS school_content_items (
  id TEXT PRIMARY KEY,
  school_id TEXT REFERENCES schools(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  language TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_content_items_school ON school_content_items(school_id);
CREATE INDEX IF NOT EXISTS idx_school_content_items_type ON school_content_items(type);
