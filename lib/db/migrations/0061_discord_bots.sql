-- Runtime migration lives in api-server/migrate.mjs; this mirrors it for drizzle-kit parity.
-- ─── بات‌ساز دیسکورد (سرویس پایتونِ irforge-dis همین جدول‌ها را می‌خواند/می‌نویسد) ───
CREATE TABLE IF NOT EXISTS discord_bots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  token_enc TEXT,
  application_id TEXT,
  bot_user_id TEXT,
  bot_username TEXT,
  blueprint JSONB NOT NULL DEFAULT '{}'::jsonb,
  blueprint_version INTEGER NOT NULL DEFAULT 1,
  desired_state TEXT NOT NULL DEFAULT 'stopped',
  restart_nonce INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  runtime_state TEXT NOT NULL DEFAULT 'offline',
  runtime_error_code TEXT,
  runtime_error TEXT,
  guild_count INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  runtime_heartbeat_at TIMESTAMPTZ,
  runner_id TEXT,
  lease_until TIMESTAMPTZ,
  synced_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS discord_bots_user_idx ON discord_bots(user_id);
CREATE INDEX IF NOT EXISTS discord_bots_desired_idx ON discord_bots(desired_state);

CREATE TABLE IF NOT EXISTS discord_bot_kv (
  bot_id TEXT NOT NULL,
  k TEXT NOT NULL,
  v TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bot_id, k)
);

CREATE TABLE IF NOT EXISTS discord_bot_logs (
  id BIGSERIAL PRIMARY KEY,
  bot_id TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS discord_bot_logs_bot_idx ON discord_bot_logs(bot_id, id DESC);
