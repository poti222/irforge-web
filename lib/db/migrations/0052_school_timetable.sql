-- 0052_school_timetable.sql
-- Runtime migration lives in api-server/migrate.mjs; this mirrors it for drizzle-kit parity.

CREATE TABLE IF NOT EXISTS school_timetable_slots (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  subject TEXT NOT NULL,
  teacher_user_id TEXT,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_timetable_class_day ON school_timetable_slots(class_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_school_timetable_school ON school_timetable_slots(school_id);
CREATE INDEX IF NOT EXISTS idx_school_timetable_teacher ON school_timetable_slots(teacher_user_id);
