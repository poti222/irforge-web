-- 0038_schools_phase10.sql
-- بخش "/schools" فاز ۱۰: حضور و غیابِ بهتر (آستانه‌ی اخطارِ غیبتِ پیاپی) +
-- آزمونِ بهتر (شکستِ نمره به‌ازایِ سؤال + ترتیبِ تصادفی).
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0029..0037.)

ALTER TABLE schools ADD COLUMN IF NOT EXISTS consecutive_absence_alert_threshold INTEGER DEFAULT 3;
ALTER TABLE school_exams ADD COLUMN IF NOT EXISTS randomize_order BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE school_exam_attempts ADD COLUMN IF NOT EXISTS answer_breakdown JSONB;
ALTER TABLE school_exam_attempts ADD COLUMN IF NOT EXISTS question_order JSONB;
