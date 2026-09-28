-- 0029_schools.sql
-- بخش "/schools" فاز ۱: مدرسه‌ها، کدهای معرف، پروفایلِ مدرسه‌ایِ کاربر.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0025/0026/0027/0028.)

CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT,
  address TEXT,
  photo_url TEXT,
  city TEXT,
  license_info TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- تا وقتی مدرسه‌ای slug ندارد، NULL می‌ماند؛ چند NULL در Postgres با هم
-- تداخل ایندکسِ یکتا ندارند (همان الگویِ users.phone).
CREATE UNIQUE INDEX IF NOT EXISTS schools_slug_unique_idx ON schools(slug) WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS school_invite_codes (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  code TEXT NOT NULL,
  role TEXT,
  created_by_user_id TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS school_invite_codes_code_unique_idx ON school_invite_codes(code);
CREATE INDEX IF NOT EXISTS idx_school_invite_codes_school ON school_invite_codes(school_id);

CREATE TABLE IF NOT EXISTS school_members (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  school_id TEXT REFERENCES schools(id),
  role TEXT,
  grade TEXT,
  national_id TEXT,
  birth_date TIMESTAMPTZ,
  city TEXT,
  school_name_free_text TEXT,
  profile_complete BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- هر کاربر حداکثر یک ردیفِ پروفایلِ مدرسه‌ای دارد.
CREATE UNIQUE INDEX IF NOT EXISTS school_members_user_id_unique_idx ON school_members(user_id);
CREATE INDEX IF NOT EXISTS idx_school_members_school ON school_members(school_id);
