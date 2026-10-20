-- 0058_school_reps.sql
-- Runtime migration lives in api-server/migrate.mjs; this mirrors it for drizzle-kit parity.

-- ─── دانش‌آموزِ منتخب (مسئولِ کلاس) + گروه‌هایِ تلگرامیِ بات + تکلیف/امتحانِ ثبت‌شده توسطِ منتخب ───
CREATE TABLE IF NOT EXISTS school_class_reps (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  class_id TEXT NOT NULL REFERENCES school_classes(id),
  student_member_id TEXT NOT NULL,
  teacher_user_id TEXT NOT NULL,
  last_prompt_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS school_class_reps_uk ON school_class_reps(class_id, student_member_id, teacher_user_id);
CREATE INDEX IF NOT EXISTS school_class_reps_student_idx ON school_class_reps(student_member_id);
CREATE INDEX IF NOT EXISTS school_class_reps_school_idx ON school_class_reps(school_id);

CREATE TABLE IF NOT EXISTS school_bot_groups (
  id TEXT PRIMARY KEY,
  school_bot_id TEXT NOT NULL REFERENCES school_bots(id),
  telegram_chat_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  chat_type TEXT NOT NULL DEFAULT 'group',
  bot_status TEXT NOT NULL DEFAULT 'member',
  can_post BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL DEFAULT 'my_chat_member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS school_bot_groups_uk ON school_bot_groups(school_bot_id, telegram_chat_id);

CREATE TABLE IF NOT EXISTS school_rep_items (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  class_id TEXT NOT NULL REFERENCES school_classes(id),
  created_by_member_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('assignment','exam','reminder')),
  title TEXT NOT NULL,
  due_date DATE NOT NULL,
  remind_days INTEGER[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','done')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS school_rep_items_class_idx ON school_rep_items(class_id, status, due_date);
CREATE INDEX IF NOT EXISTS school_rep_items_school_idx ON school_rep_items(school_id, status);

CREATE TABLE IF NOT EXISTS school_rep_item_groups (
  item_id TEXT NOT NULL REFERENCES school_rep_items(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES school_bot_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, group_id)
);

CREATE TABLE IF NOT EXISTS school_rep_reminder_log (
  item_id TEXT NOT NULL REFERENCES school_rep_items(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES school_bot_groups(id) ON DELETE CASCADE,
  days_before INTEGER NOT NULL,
  ok BOOLEAN NOT NULL DEFAULT TRUE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (item_id, group_id, days_before)
);

CREATE TABLE IF NOT EXISTS school_rep_dm_log (
  item_id TEXT NOT NULL REFERENCES school_rep_items(id) ON DELETE CASCADE,
  days_before INTEGER NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (item_id, days_before)
);
