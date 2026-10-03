-- 0039_super_gate_test_identities.sql
-- /super: گیتِ رمزِ دوم روی حساب‌هایِ واقعیِ super_admin + داشبوردِ یکجایِ
-- بات/مدرسه + «هویت‌های آزمایشی» (جایگزینِ امنِ جعلِ هویتِ نوشتنی).
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0029..0038.)

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_test_account BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by_user_id TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS is_test_school BOOLEAN NOT NULL DEFAULT false;
