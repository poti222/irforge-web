-- =========================================================================
-- Migration: V2 — password recovery via the platform Telegram bot
-- اجرا کن: psql $DATABASE_URL -f این_فایل.sql
-- =========================================================================

-- ستون‌های کد بازیابی رمز روی جدول users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reset_code_hash TEXT,
  ADD COLUMN IF NOT EXISTS reset_code_expires_at TIMESTAMPTZ;
