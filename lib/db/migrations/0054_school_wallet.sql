-- 0054_school_wallet.sql
-- Runtime migration lives in api-server/migrate.mjs; this mirrors it for drizzle-kit parity.

CREATE TABLE IF NOT EXISTS school_wallets (
  school_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS school_wallet_transactions (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  description TEXT NOT NULL,
  ref_id TEXT,
  created_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_wallet_txn_school ON school_wallet_transactions(school_id, created_at DESC);
CREATE TABLE IF NOT EXISTS school_wallet_topup_requests (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL,
  amount_rial INTEGER NOT NULL CHECK (amount_rial > 0),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by_user_id TEXT,
  decision_note TEXT,
  txn_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_school_wallet_topup_school ON school_wallet_topup_requests(school_id, status);
