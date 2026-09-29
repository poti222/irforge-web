-- 0031_schools_phase2.sql
-- بخش "/schools" فاز ۲: کلاس‌ها، برنامه‌ها، اعلامیه‌ها، یادداشتِ مشاور،
-- پیوندِ والد↔دانش‌آموز، چندمدرسه‌ایِ مدیر.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0029/0030.)

CREATE TABLE IF NOT EXISTS school_classes (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  name TEXT NOT NULL,
  grade TEXT,
  academic_year TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_classes_school ON school_classes(school_id);

CREATE TABLE IF NOT EXISTS school_class_members (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES school_classes(id),
  school_member_id TEXT NOT NULL,
  role_in_class TEXT NOT NULL DEFAULT 'student',
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_class_members_class ON school_class_members(class_id);
CREATE INDEX IF NOT EXISTS idx_school_class_members_member ON school_class_members(school_member_id);

CREATE TABLE IF NOT EXISTS school_programs (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  class_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  day_of_week TEXT,
  start_time TEXT,
  end_time TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_programs_school ON school_programs(school_id);
CREATE INDEX IF NOT EXISTS idx_school_programs_class ON school_programs(class_id);

CREATE TABLE IF NOT EXISTS school_announcements (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  class_id TEXT,
  author_user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_announcements_school ON school_announcements(school_id);
CREATE INDEX IF NOT EXISTS idx_school_announcements_class ON school_announcements(class_id);

CREATE TABLE IF NOT EXISTS school_counselor_notes (
  id TEXT PRIMARY KEY,
  counselor_user_id TEXT NOT NULL,
  student_member_id TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_counselor_notes_student ON school_counselor_notes(student_member_id);

CREATE TABLE IF NOT EXISTS school_guardianships (
  id TEXT PRIMARY KEY,
  parent_user_id TEXT NOT NULL,
  student_member_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_guardianships_parent ON school_guardianships(parent_user_id);
CREATE INDEX IF NOT EXISTS idx_school_guardianships_student ON school_guardianships(student_member_id);

CREATE TABLE IF NOT EXISTS school_admins (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  school_id TEXT NOT NULL REFERENCES schools(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS school_admins_user_school_unique_idx ON school_admins(user_id, school_id);
