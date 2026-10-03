-- 0040_school_teacher_subjects.sql
-- تخصیصِ معلم↔درس (کنترلِ دسترسیِ موضوعی به کتابخانه‌ی محتوا) — یک معلمِ
-- هندسه نباید بتواند لغت‌نامه‌ی ادبیات را ویرایش کند.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0029..0039.)

ALTER TABLE school_content_items ADD COLUMN IF NOT EXISTS subject TEXT;

CREATE TABLE IF NOT EXISTS school_teacher_subjects (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  teacher_user_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  class_id TEXT REFERENCES school_classes(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_teacher_subjects_school ON school_teacher_subjects(school_id);
CREATE INDEX IF NOT EXISTS idx_school_teacher_subjects_teacher ON school_teacher_subjects(teacher_user_id);
