-- Phase 7: bots.username/avatar are populated from Telegram (fetchBotIdentity
-- in api-server/src/lib/telegram.ts). bots.avatar only ever stores the
-- server-side proxy path (/api/bots/:botId/avatar), never a raw Telegram file
-- URL (which embeds the bot token) — this column holds the Telegram file_id
-- the proxy route re-resolves on each request.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity.)
ALTER TABLE "bots" ADD COLUMN IF NOT EXISTS "avatar_file_id" text;
