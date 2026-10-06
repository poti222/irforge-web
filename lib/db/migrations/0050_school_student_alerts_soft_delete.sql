-- 0050_school_student_alerts_soft_delete.sql
-- Runtime migration lives in api-server/migrate.mjs; this mirrors it for drizzle-kit parity.
-- حذفِ نرمِ اخطارِ دانش‌آموز: ردیف می‌ماند، متنش در هیچ پاسخی نمی‌آید.
ALTER TABLE school_student_alerts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE school_student_alerts ADD COLUMN IF NOT EXISTS deleted_by_user_id TEXT;
