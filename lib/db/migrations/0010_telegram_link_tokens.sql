-- G8: connect-via-bot deep-link flow (POST /api/auth/telegram/link/start +
-- webhook /start <token>). Runtime migration lives in api-server/migrate.mjs;
-- this file mirrors it for drizzle-kit parity.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_photo_file_id" text;

CREATE TABLE IF NOT EXISTS "telegram_link_tokens" (
  "token" text PRIMARY KEY,
  "user_id" text NOT NULL,
  "used" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "telegram_link_tokens_user_id_idx" ON "telegram_link_tokens" ("user_id");
