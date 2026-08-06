-- Checkout page (/bots/cart): per-order contact info, may differ from the
-- buyer's own profile (e.g. buying/setting up a bot on someone else's behalf).
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity.)
ALTER TABLE "bots" ADD COLUMN IF NOT EXISTS "order_phone" text;
ALTER TABLE "bots" ADD COLUMN IF NOT EXISTS "order_telegram_id" text;
