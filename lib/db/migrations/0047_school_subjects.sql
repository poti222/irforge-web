-- 0047_school_subjects.sql
-- «درس‌ها»ِ مدیریت‌شده‌یِ هر مدرسه (جایگزینِ فهرستِ ثابتِ SCHOOL_SUBJECTS) +
-- روشن/خاموشِ انواعِ محتوا در سطحِ درس و جلسه‌یِ درس.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0029..0046.)

-- بدونِ FK رویِ schools(id) (مثلِ school_content_lessons.subject، ارجاع‌ها با نام‌اند):
-- پاکسازیِ مدارسِ آزمایشیِ /super (testIdentities.ts) را نمی‌شکند.
CREATE TABLE IF NOT EXISTS school_subjects (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT,
  color TEXT,
  enabled_types JSONB NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT school_subjects_school_name_unique UNIQUE (school_id, name)
);
CREATE INDEX IF NOT EXISTS idx_school_subjects_school ON school_subjects(school_id);

ALTER TABLE schools ADD COLUMN IF NOT EXISTS subjects_seeded BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE school_content_lessons ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE school_content_lessons ADD COLUMN IF NOT EXISTS enabled_types JSONB;

-- Backfill (یک‌بار برایِ هر مدرسه، با پرچمِ subjects_seeded): ۱) ۱۲ درسِ پیش‌فرض؛
-- انواعِ فعالِ هر کدام = پیش‌فرضِ آن درس ∪ هر typeای که همین الان در آن مدرسه/درس
-- آیتم دارد (تا محتوایِ موجود با اعمالِ پیش‌فرض‌ها ناپدید نشود).
INSERT INTO school_subjects (id, school_id, name, icon, color, enabled_types, sort_order)
SELECT gen_random_uuid()::text, s.id, d.name, d.icon, d.color,
  (SELECT COALESCE(jsonb_agg(u.t ORDER BY u.ord), '[]'::jsonb)
     FROM unnest(ARRAY['dictionary','poem','formula','note','book']) WITH ORDINALITY AS u(t, ord)
    WHERE u.t = ANY(d.types)
       OR EXISTS (SELECT 1 FROM school_content_items i
                   WHERE i.school_id = s.id AND i.subject = d.name AND i.type = u.t)),
  d.ord
FROM schools s
CROSS JOIN (VALUES
    ('ریاضی', 0, 'calculator', 'blue', ARRAY['formula','note','book']::text[]),
    ('فیزیک', 1, 'atom', 'violet', ARRAY['formula','note','book']::text[]),
    ('شیمی', 2, 'flask', 'emerald', ARRAY['formula','note','book']::text[]),
    ('زیست‌شناسی', 3, 'leaf', 'emerald', ARRAY['dictionary','note','book']::text[]),
    ('ادبیاتِ فارسی', 4, 'feather', 'rose', ARRAY['dictionary','poem','note','book']::text[]),
    ('عربی', 5, 'languages', 'amber', ARRAY['dictionary','poem','note','book']::text[]),
    ('زبانِ انگلیسی', 6, 'languages', 'cyan', ARRAY['dictionary','note','book']::text[]),
    ('دینی', 7, 'scroll', 'amber', ARRAY['dictionary','note','book']::text[]),
    ('تاریخ', 8, 'landmark', 'orange', ARRAY['note','book']::text[]),
    ('جغرافیا', 9, 'globe', 'cyan', ARRAY['note','book']::text[]),
    ('ورزش', 10, 'dumbbell', 'orange', ARRAY['note','book']::text[]),
    ('سایر', 11, 'book-open', 'slate', ARRAY['dictionary','poem','formula','note','book']::text[])
) AS d(name, ord, icon, color, types)
WHERE NOT s.subjects_seeded
ON CONFLICT (school_id, name) DO NOTHING;

-- ۲) هر نامِ درسِ دیگری که در lessons/items/teacher_subjects آمده و جزوِ پیش‌فرض‌ها
-- نیست؛ همه‌یِ پنج نوع روشن (چیزی از محتوایِ موجود پنهان نشود).
INSERT INTO school_subjects (id, school_id, name, icon, color, enabled_types, sort_order)
SELECT gen_random_uuid()::text, x.school_id, x.name, NULL, NULL,
  '["dictionary","poem","formula","note","book"]'::jsonb,
  100 + (ROW_NUMBER() OVER (PARTITION BY x.school_id ORDER BY x.name))::int
FROM (
  SELECT school_id, subject AS name FROM school_content_lessons WHERE subject IS NOT NULL
  UNION SELECT school_id, subject FROM school_content_items WHERE school_id IS NOT NULL AND subject IS NOT NULL
  UNION SELECT school_id, subject FROM school_teacher_subjects WHERE subject IS NOT NULL
) x
JOIN schools s ON s.id = x.school_id
WHERE NOT s.subjects_seeded
ON CONFLICT (school_id, name) DO NOTHING;

UPDATE schools SET subjects_seeded = true WHERE NOT subjects_seeded;
