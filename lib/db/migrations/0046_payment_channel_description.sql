-- 0046_payment_channel_description.sql
-- «توضیحات» برایِ کانالِ پرداختِ خودکار: متنِ آزادِ فروشنده (مثلاً «فقط کارت‌به‌کارت، ساعت ۸ تا ۲۲»)
-- که کنارِ شماره‌کارت و نامِ صاحبِ کارت به مشتری نشان داده می‌شود. + قیدِ «لینک یا کارت (حداقل یکی)».
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it for
-- drizzle-kit parity, same convention as 0029..0045.)

-- ─── CARD_AUTOCONFIRM_DESC (توضیحاتِ کانال: متنی که کنارِ کارت به مشتری نشان داده می‌شود) ───
ALTER TABLE payment_channels ADD COLUMN IF NOT EXISTS description TEXT;

-- لینک و شماره‌کارت هر دو اختیاری‌اند (حداقل یکی): کانالِ open_link می‌تواند کارت هم داشته باشد (کارت+لینکِ مبلغ‌باز)؛
-- fixed_link پسوندِ یکتا ندارد و کارت نمی‌گیرد؛ card_manual فقط کارت. قیدِ قدیمی «نوع ⇒ فقط همان فیلد» برداشته می‌شود.
DO $$
DECLARE def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'payment_channels_kind_fields_chk' AND conrelid = 'payment_channels'::regclass;
  IF def IS NULL OR position('open_link' IN def) = 0 OR position('fixed_link' IN def) = 0 OR position('IS NULL' IN def) = 0 THEN
    IF def IS NOT NULL THEN
      ALTER TABLE payment_channels DROP CONSTRAINT payment_channels_kind_fields_chk;
    END IF;
    ALTER TABLE payment_channels ADD CONSTRAINT payment_channels_kind_fields_chk CHECK (
      (kind = 'card_manual' AND card_number_enc IS NOT NULL)
      OR (kind = 'open_link' AND payment_url IS NOT NULL)
      OR (kind = 'fixed_link' AND payment_url IS NOT NULL AND card_number_enc IS NULL)
    );
  END IF;
END $$;
