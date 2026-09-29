-- 0030_card_autoconfirm_effects.sql
-- Bot-scope confirm-effect claim columns for the shared card-to-card module.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it.)

-- ─── CARD_AUTOCONFIRM_P5 (اثرِ تأییدِ باتِ فروشنده: claim یک‌باره) ─────────
-- درخواست‌های scope=bot را خودِ بات تأیید-اجرا می‌کند (شارژ کیف‌پول/پرداخت سفارش
-- در Sheets/Postgresِ همان بات). برای اینکه اثر فقط یک‌بار اعمال شود، بات اول
-- روی سایت «claim» می‌کند (UPDATE اتمیک)؛ بعد از اعمال، effect_done_at ثبت می‌شود.
-- claim بدون lease است (at-most-once): اگر بات وسطِ کار بمیرد، ردیف claimشده ولی
-- done-نشده می‌ماند و ادمین باخبر می‌شود — هرگز دوبار شارژ نمی‌شود.

ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS effect_claimed_at TIMESTAMPTZ;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS effect_done_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payment_requests_effect_chk' AND conrelid = 'payment_requests'::regclass
  ) THEN
    ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_effect_chk CHECK (
      (effect_claimed_at IS NULL OR status = 'confirmed')
      AND (effect_done_at IS NULL OR effect_claimed_at IS NOT NULL)
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payment_requests_effect_pending
  ON payment_requests (bot_id, confirmed_at)
  WHERE status = 'confirmed' AND effect_claimed_at IS NULL;
