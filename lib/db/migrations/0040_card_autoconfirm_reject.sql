-- 0040_card_autoconfirm_reject.sql
-- Manual (admin) reject audit columns for the shared card-to-card module.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it.)

-- ─── CARD_AUTOCONFIRM_P6 (ردِ دستیِ ادمین: چه کسی، چرا، کِی) ────────────────
-- تأییدِ دستی از قبل confirmed_by_admin_id دارد؛ ردِ دستی هم باید قابلِ ردیابی باشد.
-- «اولین تصمیم برنده است» با UPDATE شرطی روی status تضمین می‌شود، نه با این ستون‌ها.

ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS rejected_by_admin_id TEXT;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS reject_reason TEXT;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payment_requests_reject_chk' AND conrelid = 'payment_requests'::regclass
  ) THEN
    ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_reject_chk CHECK (
      (rejected_by_admin_id IS NULL AND rejected_at IS NULL AND reject_reason IS NULL) OR status = 'rejected'
    );
  END IF;
END $$;
