-- 0041_school_content_lessons.sql
-- لایه‌یِ «درس» رویِ کتابخانه‌ی محتوا (لغت‌نامه/شعر/جزوه/کتاب/فرمول) — طبقِ
-- گزارشِ کاربر: «باید بشه یه درس بسازی و توش شعر یا لغت اضافه کنی».
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0029..0040.)

CREATE TABLE IF NOT EXISTS school_content_lessons (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  subject TEXT NOT NULL,
  title TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_content_lessons_school ON school_content_lessons(school_id);
CREATE INDEX IF NOT EXISTS idx_school_content_lessons_subject ON school_content_lessons(subject);

ALTER TABLE school_content_items ADD COLUMN IF NOT EXISTS lesson_id TEXT;
CREATE INDEX IF NOT EXISTS idx_school_content_items_lesson ON school_content_items(lesson_id);
