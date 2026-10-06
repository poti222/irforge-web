-- 0046_payment_channel_description.sql
-- «توضیحات» برایِ کانالِ پرداختِ خودکار: متنِ آزادِ فروشنده (مثلاً «فقط کارت‌به‌کارت، ساعت ۸ تا ۲۲»)
-- که کنارِ شماره‌کارت و نامِ صاحبِ کارت به مشتری نشان داده می‌شود.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it for
-- drizzle-kit parity, same convention as 0029..0045.)

-- ─── CARD_AUTOCONFIRM_DESC (توضیحاتِ کانال: متنی که کنارِ کارت به مشتری نشان داده می‌شود) ───
ALTER TABLE payment_channels ADD COLUMN IF NOT EXISTS description TEXT;
