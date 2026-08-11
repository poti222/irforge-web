/* DEAD CODE: مایگریشنی که واقعاً اجرا می‌شود api-server/migrate.mjs است
   (start.sh آن را صدا می‌زند). این فایل قدیمی و از رده خارج است. */
/**
 * migrate.mjs
 * Creates all tables if they don't exist. Runs before server start.
 * Uses raw SQL so no TypeScript compilation needed at runtime.
 */
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("[migrate] DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SQL = `
-- ─── USERS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  plan TEXT NOT NULL DEFAULT 'free',
  bio TEXT,
  telegram_id TEXT UNIQUE,
  telegram_username TEXT,
  telegram_first_name TEXT,
  telegram_last_name TEXT,
  telegram_photo_url TEXT,
  phone TEXT,
  platform_username TEXT,
  profile_complete BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active',
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- upgrade existing installs
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_complete BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_first_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_last_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_photo_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_photo_file_id TEXT;

-- ─── SESSIONS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- ─── BOTS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending_payment',
  token TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT,
  avatar TEXT,
  command_count INTEGER NOT NULL DEFAULT 0,
  plugin_count INTEGER NOT NULL DEFAULT 0,
  user_count INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  sheet_id TEXT,
  admin_code TEXT,
  admin_code_used BOOLEAN NOT NULL DEFAULT false,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- upgrade existing installs (Group 2 columns)
ALTER TABLE bots ADD COLUMN IF NOT EXISTS sheet_id TEXT;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS admin_code TEXT;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS admin_code_used BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending';
-- existing active/inactive bots are already paid
UPDATE bots SET payment_status = 'approved'
  WHERE status IN ('active', 'inactive', 'error') AND payment_status = 'pending';

-- ─── COMMANDS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  permission TEXT NOT NULL DEFAULT 'all',
  arguments JSONB NOT NULL DEFAULT '[]',
  workflow JSONB,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- upgrade existing installs (old schema had response/type instead of permission/arguments/workflow)
ALTER TABLE commands ADD COLUMN IF NOT EXISTS permission TEXT NOT NULL DEFAULT 'all';
ALTER TABLE commands ADD COLUMN IF NOT EXISTS arguments JSONB NOT NULL DEFAULT '[]';
ALTER TABLE commands ADD COLUMN IF NOT EXISTS workflow JSONB;

-- ─── PLANS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  interval TEXT NOT NULL DEFAULT 'monthly',
  features TEXT[] NOT NULL DEFAULT '{}',
  max_bots INTEGER NOT NULL DEFAULT 1,
  max_plugins INTEGER NOT NULL DEFAULT 5,
  max_users INTEGER NOT NULL DEFAULT 100,
  popular BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── USER_PLANS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  plan_id TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  renews_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── THEMES ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  primary_color TEXT,
  secondary_color TEXT,
  font TEXT,
  preview_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── ACTIVITY ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  bot_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── MARKETPLACE_ITEMS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  price REAL NOT NULL DEFAULT 0,
  author_id TEXT,
  downloads INTEGER NOT NULL DEFAULT 0,
  rating REAL NOT NULL DEFAULT 0,
  version TEXT NOT NULL DEFAULT '1.0.0',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS version TEXT NOT NULL DEFAULT '1.0.0';

-- ─── INSTALLED_PLUGINS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS installed_plugins (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  marketplace_item_id TEXT,
  name TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '1.0.0',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- upgrade existing installs
ALTER TABLE installed_plugins ADD COLUMN IF NOT EXISTS marketplace_item_id TEXT;
ALTER TABLE installed_plugins ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
ALTER TABLE installed_plugins ADD COLUMN IF NOT EXISTS version TEXT NOT NULL DEFAULT '1.0.0';
ALTER TABLE installed_plugins ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- ─── PAYMENTS (Group 2) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bot_id TEXT,
  receipt_url TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payments_user_id_idx ON payments(user_id);
CREATE INDEX IF NOT EXISTS payments_bot_id_idx  ON payments(bot_id);
CREATE INDEX IF NOT EXISTS payments_status_idx  ON payments(status);

-- ─── SHEET_POOL (Group 2) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheet_pool (
  id TEXT PRIMARY KEY,
  sheet_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'available',
  assigned_bot_id TEXT,
  added_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sheet_pool_status_idx ON sheet_pool(status);

-- ─── TELEGRAM_LINK_TOKENS (G8: connect via bot deep-link) ──────────────────
CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS telegram_link_tokens_user_id_idx ON telegram_link_tokens(user_id);

-- ─── TICKETS (Z4 + G7 support-bot bridge) ─────────────────────────────────
-- NOTE: previously only defined in drizzle SQL migrations (not run at runtime),
-- so these tables were missing on fresh deploys. Created here idempotently.
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  -- G7: support-bot-originated tickets carry Telegram/tenant context
  source TEXT NOT NULL DEFAULT 'web',
  telegram_id TEXT,
  tenant TEXT,
  issue_type TEXT,
  user_url TEXT,
  admin_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- user_id becomes nullable (bot tickets have no site user)
ALTER TABLE tickets ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS telegram_id TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tenant TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS issue_type TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS user_url TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS admin_url TEXT;
CREATE INDEX IF NOT EXISTS tickets_user_id_idx ON tickets(user_id);
CREATE INDEX IF NOT EXISTS tickets_source_idx  ON tickets(source);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_role TEXT NOT NULL DEFAULT 'user',
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ticket_messages_ticket_id_idx ON ticket_messages(ticket_id);

-- ─── WALLET (Z5) — also missing from runtime migrate; created idempotently ──
CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  balance INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  receipt_url TEXT,
  tx_hash TEXT,
  reviewed_by TEXT,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wallet_transactions_user_id_idx ON wallet_transactions(user_id);

-- ─── Round 3 / Phase 2 — case-insensitive e-mail identity ──────────────────
-- Mirrors lib/db/migrations/0018_email_case_insensitive.sql. It has to live
-- here too: this file is what actually runs at boot on Railway, and it does not
-- read lib/db/migrations at all.
--
-- If two accounts differ only by letter case this RAISEs and the boot fails
-- loudly. That is deliberate — the alternative is a service that keeps running
-- while two accounts share one real mailbox — but it does mean a production
-- database with such a pair will not start until a human resolves it. Check
-- before deploying with:
--   SELECT lower(email), count(*) FROM users GROUP BY 1 HAVING count(*) > 1;
DO $$
DECLARE
  collisions TEXT;
BEGIN
  SELECT string_agg(DISTINCT lower(email), ', ')
    INTO collisions
    FROM users
   GROUP BY lower(email)
  HAVING count(*) > 1;

  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot normalise user e-mails: % address(es) are held by more than one account, differing only in letter case. Resolve them by hand before starting the service.',
      collisions
      USING ERRCODE = 'unique_violation';
  END IF;
END $$;

UPDATE users SET email = lower(email) WHERE email <> lower(email);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_unique;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log("[migrate] Running migrations...");
    await client.query(SQL);
    console.log("[migrate] Done.");
  } catch (err) {
    console.error("[migrate] Error:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
