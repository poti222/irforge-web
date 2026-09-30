-- 0035_schools_phase6.sql
-- بخش "/schools" فاز ۶: حضور و غیاب، اخطار/هشدارِ دانش‌آموز، ارسالِ دیرهنگامِ آزمون.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0029..0034.)

CREATE TABLE IF NOT EXISTS school_attendance (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES school_classes(id),
  student_member_id TEXT NOT NULL,
  date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'present',
  marked_by_user_id TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS school_attendance_uniq_idx ON school_attendance(class_id, student_member_id, date);
CREATE INDEX IF NOT EXISTS idx_school_attendance_student ON school_attendance(student_member_id);

CREATE TABLE IF NOT EXISTS school_student_alerts (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  student_member_id TEXT NOT NULL,
  issued_by_user_id TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'notice',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_student_alerts_student ON school_student_alerts(student_member_id);
CREATE INDEX IF NOT EXISTS idx_school_student_alerts_school ON school_student_alerts(school_id);

ALTER TABLE school_exam_attempts ADD COLUMN IF NOT EXISTS late_submission BOOLEAN NOT NULL DEFAULT FALSE;
