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
  reset_code_hash TEXT,
  reset_code_expires_at TIMESTAMPTZ,
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
-- G8: bot-linking flow (webhook /start <token>) only ever gets a file_id, not
-- a public photo URL, so it's stored separately and served through a proxy.
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_photo_file_id TEXT;
-- V2: password recovery via the platform Telegram bot (was previously only in
-- migrations/0005_password_reset.sql, which this runtime script never ran —
-- caused every login/register/me query to 500 with "column reset_code_hash
-- does not exist", since drizzle selects every column the schema declares).
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code_expires_at TIMESTAMPTZ;
-- Z8: 7-day free trial (one per account) — was only added to the Drizzle TS
-- schema, never to this runtime script, which caused every login/register/me
-- query to 500 with "column has_used_trial does not exist".
ALTER TABLE users ADD COLUMN IF NOT EXISTS has_used_trial BOOLEAN NOT NULL DEFAULT false;

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
-- Z8: 7-day free trial (same story — declared in Drizzle schema, never here)
ALTER TABLE bots ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ;
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
  ram_gb REAL NOT NULL DEFAULT 1,
  cpu_cores REAL NOT NULL DEFAULT 1,
  popular BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- resource sizing, added after the table already existed in production
ALTER TABLE plans ADD COLUMN IF NOT EXISTS ram_gb REAL NOT NULL DEFAULT 1;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS cpu_cores REAL NOT NULL DEFAULT 1;

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
-- NOTE: this table was originally created here with an early/legacy shape
-- (description, secondary_color, font, preview_url) that predates the actual
-- theme-editor feature (src/pages/themes.tsx + routes/themes.ts), which reads
-- and writes mode/background_color/foreground_color/accent_color/
-- border_radius/font_family/user_id/is_default/is_active. Because those
-- columns were only ever added to the Drizzle TS schema — never to this
-- runtime script, and there's no migrations/*.sql for it either — every
-- themes query 500'd with "column ... does not exist". Legacy columns are
-- left in place (unused, harmless) rather than dropped, in case any theme
-- rows already exist.
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
ALTER TABLE themes ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'dark';
ALTER TABLE themes ADD COLUMN IF NOT EXISTS background_color TEXT NOT NULL DEFAULT '';
ALTER TABLE themes ADD COLUMN IF NOT EXISTS foreground_color TEXT NOT NULL DEFAULT '';
ALTER TABLE themes ADD COLUMN IF NOT EXISTS accent_color TEXT NOT NULL DEFAULT '';
ALTER TABLE themes ADD COLUMN IF NOT EXISTS border_radius TEXT NOT NULL DEFAULT '0.5rem';
ALTER TABLE themes ADD COLUMN IF NOT EXISTS font_family TEXT NOT NULL DEFAULT 'Inter';
ALTER TABLE themes ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT '';
ALTER TABLE themes ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE themes ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE themes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

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
-- Z3: amount on receipts, for the invoices page
ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount INTEGER;

-- ─── TICKETS (Z4 + G7) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  subject     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  source      TEXT NOT NULL DEFAULT 'web',
  telegram_id TEXT,
  tenant      TEXT,
  issue_type  TEXT,
  user_url    TEXT,
  admin_url   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- upgrade existing installs (G7: support-bot ticket bridge)
ALTER TABLE tickets ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS telegram_id TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tenant TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS issue_type TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS user_url TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS admin_url TEXT;
CREATE INDEX IF NOT EXISTS tickets_source_idx ON tickets(source);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id          TEXT PRIMARY KEY,
  ticket_id   TEXT NOT NULL,
  sender_id   TEXT NOT NULL,
  sender_role TEXT NOT NULL DEFAULT 'user',
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id);

-- ─── WALLET (Z5) ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL UNIQUE,
  balance     INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  type         TEXT NOT NULL,
  amount       INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  receipt_url  TEXT,
  tx_hash      TEXT,
  reviewed_by  TEXT,
  review_note  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_status ON wallet_transactions(status);

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

-- ─── NOTIFICATIONS (Z8: trial warnings, etc.) ──────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bot_id TEXT,
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  dedupe_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx
  ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- ─── CHECKOUT ORDER CONTACT (/bots/cart) ───────────────────────────────────
-- Per-order phone/Telegram ID, which may differ from the buyer's own profile.
ALTER TABLE bots ADD COLUMN IF NOT EXISTS order_phone TEXT;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS order_telegram_id TEXT;

-- ─── BOT AVATAR (Phase 7: real Telegram identity) ──────────────────────────
-- bots.avatar only ever stores the server-side proxy path
-- (/api/bots/:botId/avatar), never a raw Telegram file URL (that URL embeds
-- the bot token). This column holds the Telegram file_id the proxy route
-- re-resolves to a short-lived file_path on every request.
ALTER TABLE bots ADD COLUMN IF NOT EXISTS avatar_file_id TEXT;

-- ─── ANNOUNCEMENTS ─────────────────────────────────────────────────────────
-- FIX: این جدول در schema (lib/db/src/schema/activity.ts) و در روت‌های
-- admin.ts وجود داشت ولی هیچ‌وقت در هیچ مایگریشنی ساخته نمی‌شد — نه اینجا و
-- نه در lib/db/migrations/*.sql. نتیجه: POST /api/admin/announcements با
-- «relation "announcements" does not exist» می‌ترکید و به کاربر فقط
-- «Internal server error» نشان داده می‌شد، و GET هم ۵۰۰ می‌داد و لیست ادمین
-- برای همیشه روی skeleton گیر می‌کرد.
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS announcements_created_at_idx ON announcements(created_at DESC);

-- ─── DISCOUNT_CODES / DISCOUNT_REDEMPTIONS — REMOVED FROM POSTGRES ──────────
-- Discount data (codes + redemption audit log) now lives entirely in Google
-- Sheets — see api-server/src/lib/discountStore.ts. Postgres must not hold
-- any of it, so on every boot we make sure these tables are gone (covers
-- databases that were provisioned before this change).
DROP TABLE IF EXISTS discount_redemptions;
DROP TABLE IF EXISTS discount_codes;
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
