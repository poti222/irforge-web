-- 0033_schools_phase4.sql
-- بخش "/schools" فاز ۴: گزارش/برنامه/چتِ مشاور، بانکِ سؤال، آزمون.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0029/0030/0031/0032.)

ALTER TABLE school_programs ADD COLUMN IF NOT EXISTS counselor_user_id TEXT;

CREATE TABLE IF NOT EXISTS school_counselor_reports (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  counselor_user_id TEXT NOT NULL,
  student_member_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_counselor_reports_school ON school_counselor_reports(school_id);
CREATE INDEX IF NOT EXISTS idx_school_counselor_reports_counselor ON school_counselor_reports(counselor_user_id);

CREATE TABLE IF NOT EXISTS school_counselor_messages (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  counselor_user_id TEXT NOT NULL,
  student_member_id TEXT NOT NULL,
  sender_user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_counselor_messages_pair ON school_counselor_messages(counselor_user_id, student_member_id);

CREATE TABLE IF NOT EXISTS school_questions (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  teacher_user_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  choices JSONB,
  correct_answer TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_questions_teacher ON school_questions(teacher_user_id);
CREATE INDEX IF NOT EXISTS idx_school_questions_school ON school_questions(school_id);

CREATE TABLE IF NOT EXISTS school_exams (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES school_classes(id),
  teacher_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  question_ids JSONB NOT NULL DEFAULT '[]',
  scheduled_at TIMESTAMPTZ,
  duration_minutes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_exams_class ON school_exams(class_id);

CREATE TABLE IF NOT EXISTS school_exam_attempts (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES school_exams(id),
  student_member_id TEXT NOT NULL,
  answers JSONB NOT NULL DEFAULT '{}',
  score TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS school_exam_attempts_uniq_idx ON school_exam_attempts(exam_id, student_member_id);
CREATE INDEX IF NOT EXISTS idx_school_exam_attempts_student ON school_exam_attempts(student_member_id);
