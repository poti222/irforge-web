-- G7: support-bot ticket bridge — bot-originated tickets carry Telegram/tenant
-- context and have no site user. (Runtime migration lives in api-server/migrate.mjs;
-- this file mirrors it for drizzle-kit parity.)
ALTER TABLE "tickets" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'web';
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "telegram_id" text;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "tenant" text;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "issue_type" text;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "user_url" text;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "admin_url" text;
CREATE INDEX IF NOT EXISTS "tickets_source_idx" ON "tickets" ("source");
