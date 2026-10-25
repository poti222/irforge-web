-- Runtime migration lives in api-server/migrate.mjs; this mirrors it for drizzle-kit parity.
CREATE TABLE IF NOT EXISTS emoji_pack_purchases (
  bot_id TEXT NOT NULL,
  pack_slug TEXT NOT NULL,
  user_id TEXT NOT NULL,
  price_toman INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bot_id, pack_slug)
);
