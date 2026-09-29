-- 0032_schools_phase3.sql
-- بخش "/schools" فاز ۳: فیلدِ URLِ عکسِ آیتمِ محتوا، تکالیف.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0029/0030/0031.)

ALTER TABLE school_content_items ADD COLUMN IF NOT EXISTS image_url TEXT;

CREATE TABLE IF NOT EXISTS school_assignments (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES school_classes(id),
  teacher_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_assignments_class ON school_assignments(class_id);

CREATE TABLE IF NOT EXISTS school_assignment_submissions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES school_assignments(id),
  student_member_id TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  submitted_at TIMESTAMPTZ,
  grade TEXT,
  feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS school_assignment_submissions_uniq_idx ON school_assignment_submissions(assignment_id, student_member_id);
CREATE INDEX IF NOT EXISTS idx_school_assignment_submissions_student ON school_assignment_submissions(student_member_id);
