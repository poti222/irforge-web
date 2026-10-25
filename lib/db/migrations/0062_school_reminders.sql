-- Runtime migration lives in api-server/migrate.mjs; this mirrors it for drizzle-kit parity.
-- ─── یادآورهایِ دانش‌آموزی (خودکار، چندساعته، روزهایِ دلخواه؛ ویرایش: دانش‌آموزِ منتخب/معلم/مدیر) ───
-- weekdays: شنبه=۰ … جمعه=۶ · times: "HH:MM" به وقتِ تهران · class_id NULL = کلِ مدرسه (فقط مدیر).
CREATE TABLE IF NOT EXISTS school_reminders (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  class_id TEXT REFERENCES school_classes(id),
  title TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  weekdays INTEGER[] NOT NULL,
  times TEXT[] NOT NULL,
  start_date DATE,
  end_date DATE,
  skip_dates DATE[] NOT NULL DEFAULT '{}',
  send_dm BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id TEXT NOT NULL,
  created_by_role TEXT NOT NULL,
  updated_by_user_id TEXT,
  last_fired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS school_reminders_school_idx ON school_reminders(school_id, active);
CREATE INDEX IF NOT EXISTS school_reminders_class_idx ON school_reminders(class_id);

CREATE TABLE IF NOT EXISTS school_reminder_groups (
  reminder_id TEXT NOT NULL REFERENCES school_reminders(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES school_bot_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (reminder_id, group_id)
);

-- هر (یادآور، روز، ساعت، مقصد) حداکثر یک‌بار: ثبتِ ردیف پیش از ارسال = claim (ری‌استارت/چندنمونه‌ای امن).
CREATE TABLE IF NOT EXISTS school_reminder_log (
  reminder_id TEXT NOT NULL REFERENCES school_reminders(id) ON DELETE CASCADE,
  run_date DATE NOT NULL,
  run_time TEXT NOT NULL,
  target TEXT NOT NULL,
  ok BOOLEAN NOT NULL DEFAULT TRUE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (reminder_id, run_date, run_time, target)
);
CREATE INDEX IF NOT EXISTS school_reminder_log_date_idx ON school_reminder_log(run_date);
