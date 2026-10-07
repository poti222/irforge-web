-- 0055_school_wallet_topup_scope.sql
-- Runtime migration lives in api-server/migrate.mjs; this mirrors it for drizzle-kit parity.

-- ─── شارژِ کیف‌پولِ «مدرسه» روی همین ماژول (purpose سوم؛ scope همچنان platform) ──────
-- school_id فقط برایِ purpose='school_wallet_topup' پر است؛ کانال/مبلغِ یکتا/تطبیقِ پیامک همان‌ها هستند.
-- CHECKِ purpose روی دیتابیسِ قدیمی idempotent جایگزین می‌شود (فقط اگر هنوز school_wallet_topup را نمی‌شناسد).
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS school_id TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payment_requests_purpose_chk' AND conrelid = 'payment_requests'::regclass
       AND pg_get_constraintdef(oid) LIKE '%school_wallet_topup%'
  ) THEN
    ALTER TABLE payment_requests DROP CONSTRAINT IF EXISTS payment_requests_purpose_chk;
    ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_purpose_chk
      CHECK (purpose IN ('wallet_topup', 'order', 'school_wallet_topup'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_requests_school_chk' AND conrelid = 'payment_requests'::regclass) THEN
    ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_school_chk
      CHECK ((purpose = 'school_wallet_topup') = (school_id IS NOT NULL) AND (school_id IS NULL OR scope = 'platform'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_payment_requests_school ON payment_requests(school_id, created_at DESC) WHERE school_id IS NOT NULL;

