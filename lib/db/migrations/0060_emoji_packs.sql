-- Runtime migration lives in api-server/migrate.mjs; this mirrors it for drizzle-kit parity.
CREATE TABLE IF NOT EXISTS emoji_packs (
  slug TEXT PRIMARY KEY,
  title_fa TEXT NOT NULL,
  title_en TEXT NOT NULL DEFAULT '',
  tg_set_name TEXT,
  price_toman INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  stickers JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
