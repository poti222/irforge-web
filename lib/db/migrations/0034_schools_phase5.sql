-- 0034_schools_phase5.sql
-- بخش "/schools" فاز ۵: ارتباط با مدیر/معلم.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0029/0030/0031/0032/0033.)

CREATE TABLE IF NOT EXISTS school_admin_messages (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  student_member_id TEXT NOT NULL,
  sender_user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_admin_messages_student ON school_admin_messages(school_id, student_member_id);

CREATE TABLE IF NOT EXISTS school_teacher_messages (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  teacher_user_id TEXT NOT NULL,
  student_member_id TEXT NOT NULL,
  sender_user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_teacher_messages_pair ON school_teacher_messages(teacher_user_id, student_member_id);
