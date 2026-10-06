-- 0051_uploaded_images.sql
-- Runtime migration lives in api-server/migrate.mjs; this mirrors it for drizzle-kit parity.

CREATE TABLE IF NOT EXISTS uploaded_images (
  id TEXT PRIMARY KEY,
  uploaded_by_user_id TEXT NOT NULL,
  mime TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_uploaded_images_user ON uploaded_images(uploaded_by_user_id);
