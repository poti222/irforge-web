-- 0057_school_subject_classes.sql
-- Runtime migration lives in api-server/migrate.mjs; this mirrors it for drizzle-kit parity.

-- ─── دسترسیِ هر درس به کلاس‌ها: بدونِ ردیف = همهٔ کلاس‌ها (پیش‌فرض)؛ مایگریشنِ ۰۰۵۷ همین را تکرار می‌کند ───
CREATE TABLE IF NOT EXISTS school_subject_classes (
  subject_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  PRIMARY KEY (subject_id, class_id)
);
CREATE INDEX IF NOT EXISTS idx_school_subject_classes_class ON school_subject_classes(class_id);
