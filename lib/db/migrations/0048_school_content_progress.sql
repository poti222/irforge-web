-- 0048_school_content_progress.sql
-- Runtime migration lives in api-server/migrate.mjs; this mirrors it for drizzle-kit parity.
-- ببینید توضیحِ بلوکِ همنام در migrate.mjs: جدول فقط در drizzle تعریف شده بود و هرگز ساخته نمی‌شد.

CREATE TABLE IF NOT EXISTS school_content_progress (
  id TEXT PRIMARY KEY,
  content_item_id TEXT NOT NULL,
  student_member_id TEXT NOT NULL,
  last_rating TEXT NOT NULL,
  review_count INTEGER NOT NULL DEFAULT 0,
  interval_days INTEGER NOT NULL DEFAULT 1,
  next_review_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_content_progress_member_item ON school_content_progress(student_member_id, content_item_id);
CREATE INDEX IF NOT EXISTS idx_school_content_progress_item ON school_content_progress(content_item_id);
