-- =========================================================================
-- Migration: Group 2 — زیرساخت دیتابیس
-- اجرا کن: psql $DATABASE_URL -f این_فایل.sql
-- یا از طریق drizzle-kit: pnpm db:migrate
-- =========================================================================

-- ─── 1. جدول users — فیلدهای جدید ────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS platform_username TEXT,
  ADD COLUMN IF NOT EXISTS profile_complete BOOLEAN NOT NULL DEFAULT false;

-- ─── 2. جدول bots — فیلدهای جدید ─────────────────────────────────────────

-- ابتدا status های موجود رو به inactive تبدیل نمی‌کنیم
-- چون رکوردهای فعلی باید active/inactive بمونن
ALTER TABLE bots
  ADD COLUMN IF NOT EXISTS sheet_id TEXT,
  ADD COLUMN IF NOT EXISTS admin_code TEXT,
  ADD COLUMN IF NOT EXISTS admin_code_used BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending';

-- بات‌های موجود که قبلاً active/inactive بودن = پرداختشون تأیید شده
UPDATE bots
  SET payment_status = 'approved'
  WHERE status IN ('active', 'inactive', 'error')
    AND payment_status = 'pending';

-- ─── 3. جدول payments — جدید ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payments (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  bot_id           TEXT,
  receipt_url      TEXT NOT NULL,
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  reviewed_by      TEXT,
  review_note      TEXT,
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payments_user_id_idx ON payments(user_id);
CREATE INDEX IF NOT EXISTS payments_bot_id_idx  ON payments(bot_id);
CREATE INDEX IF NOT EXISTS payments_status_idx  ON payments(status);

-- ─── 4. جدول sheet_pool — جدید ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sheet_pool (
  id               TEXT PRIMARY KEY,
  sheet_id         TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'available',
  assigned_bot_id  TEXT,
  added_by         TEXT,
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sheet_pool_status_idx ON sheet_pool(status);
