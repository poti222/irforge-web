-- 0028_wallet_topups.sql
-- Wallet top-up via a single open-amount BluBank payment link + automatic
-- bank-SMS matching. Each order gets a unique final_amount (requested
-- amount + a random 3-digit suffix) instead of relying on only one pending
-- order per fixed amount at a time.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0025/0026/0027.)

CREATE TABLE IF NOT EXISTS wallet_topups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  requested_amount INTEGER NOT NULL,
  suffix INTEGER NOT NULL,
  final_amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  matched_sms_id TEXT,
  receipt_image_url TEXT,
  receipt_uploaded_at TIMESTAMPTZ,
  admin_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_wallet_topups_user ON wallet_topups(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_topups_status ON wallet_topups(status);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_topups_pending_final_amount_uk
  ON wallet_topups (final_amount) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS sms_logs (
  id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL,
  sender TEXT,
  parsed_amount INTEGER,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  matched_payment_id TEXT,
  webhook_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sms_logs_parsed_amount ON sms_logs(parsed_amount);
