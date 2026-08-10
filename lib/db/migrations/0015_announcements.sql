-- 0015_announcements.sql
-- FIX: جدول announcements در lib/db/src/schema/activity.ts تعریف شده بود و
-- api-server/src/routes/admin.ts روی آن insert/select می‌زد، ولی هیچ مایگریشنی
-- آن را نمی‌ساخت. نتیجه: POST/GET /api/admin/announcements همیشه ۵۰۰ می‌داد.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0014_discount_codes.sql.)

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS announcements_created_at_idx ON announcements(created_at DESC);
