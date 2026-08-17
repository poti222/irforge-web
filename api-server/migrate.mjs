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

-- The CREATE TABLE above and the Drizzle schema (lib/db/src/schema/marketplace.ts)
-- had drifted apart: the schema declares is_free/author/install_count/tags/icon/
-- featured, none of which were ever created here, while this table has author_id/
-- downloads/status, which the schema does not know about.
--
-- Nothing surfaced it because nothing ever wrote to this table — the marketplace
-- was empty, so no INSERT ever failed. And Drizzle names every column explicitly
-- in its SELECT too, which means GET /marketplace/items was erroring rather
-- than returning an empty list. Adding the plugin sync is what finally exposed it.
--
-- NOTE: this whole SQL block is a JS template literal, so no backticks below.
--
-- Additive only: the three legacy columns stay (dropping them would break any
-- reader still expecting them, and they cost nothing).
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS author TEXT NOT NULL DEFAULT 'IrForge';
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS install_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS icon TEXT;
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT FALSE;

-- Both languages for the display text. The sync used to write name_fa into the
-- single "name" column, so an English-speaking visitor saw Persian names.
-- NOTE: no backticks anywhere in this block - it is a JS template literal.
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS name_fa TEXT NOT NULL DEFAULT '';
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS description_fa TEXT NOT NULL DEFAULT '';

-- "downloads" was the old name for "install_count". Copy it across once, only
-- where the new column is still at its default, so a real install count isn't
-- lost and re-running this never overwrites a newer value. Guarded because the
-- legacy column is absent on databases created after the schema changed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'marketplace_items' AND column_name = 'downloads'
  ) THEN
    UPDATE marketplace_items SET install_count = downloads
    WHERE install_count = 0 AND downloads > 0;
  END IF;
END $$;

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

-- ─── SITE UPDATES (تغییرات و امکانات جدید سایت) ────────────────────────────
CREATE TABLE IF NOT EXISTS site_updates (
  id TEXT PRIMARY KEY,
  version TEXT,                                  -- اختیاری، مثل "v1.4"
  title TEXT NOT NULL,
  body TEXT NOT NULL,                            -- متن ساده با خط جدید
  published BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS site_updates_published_idx
  ON site_updates(published, published_at DESC);

-- بدنه‌ی آپدیت: دنباله‌ی مرتب بلوک‌ها (متن/عکس) به‌جای body ثابت + عکس‌ها.
-- ستون body و جدول site_update_images عمداً حذف نمی‌شوند: یک نسخه نگه داشته
-- می‌شوند تا برگشت به عقب ممکن باشد. پاک‌سازی، مایگریشن بعدی.
-- (توجه: این متن داخل یک template literal است — هیچ backtick اینجا ننویس.)
ALTER TABLE site_updates ADD COLUMN IF NOT EXISTS blocks JSONB NOT NULL DEFAULT '[]'::jsonb;

-- عکس‌ها جدا نگه داشته می‌شوند تا لیست آپدیت‌ها مجبور نباشد چند مگابایت
-- base64 حمل کند؛ فقط endpoint جزئیات آن‌ها را می‌خواند.
CREATE TABLE IF NOT EXISTS site_update_images (
  id TEXT PRIMARY KEY,
  update_id TEXT NOT NULL,
  data_url TEXT NOT NULL,                        -- data:image/...;base64,...
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS site_update_images_update_idx
  ON site_update_images(update_id, sort_order);

-- چه کسی کدام آپدیت را دیده — منبع حقیقت برای «مودال فقط یک‌بار».
CREATE TABLE IF NOT EXISTS user_update_views (
  user_id TEXT NOT NULL,
  update_id TEXT NOT NULL,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, update_id)
);

-- ⚠️ ترتیب مهم است: این backfill از site_update_images می‌خواند، پس باید
-- بعد از ساخته‌شدن آن جدول بیاید — نه کنار ALTER TABLE بالا. اگر بالاتر
-- باشد، روی یک دیتابیس تازه با «relation site_update_images does not exist»
-- می‌ترکد و کل بوت را می‌خواباند.
-- backfill یک‌بار مصرف و idempotent: فقط ردیف‌هایی که هنوز تبدیل نشده‌اند.
-- body می‌شود یک بلوک متن، بعد هر عکس به‌ترتیب sort_order یک بلوک عکس —
-- دقیقاً همان چیدمانی که قبلاً رندر می‌شد، پس چیزی روی صفحه جابه‌جا نمی‌شود.
-- alt از عنوان آپدیت پر می‌شود: این ردیف‌ها هیچ‌وقت alt نداشتند و ساختن یک
-- توضیح برای عکسی که ندیده‌ایم بدتر از استفاده از عنوانِ درست است.
UPDATE site_updates u
   SET blocks = (
     SELECT COALESCE(jsonb_agg(b ORDER BY ord), '[]'::jsonb)
       FROM (
         SELECT 0 AS ord,
                jsonb_build_object('type','text','id',md5(u.id || ':body'),'content',u.body) AS b
          WHERE COALESCE(btrim(u.body), '') <> ''
         UNION ALL
         SELECT i.sort_order + 1 AS ord,
                jsonb_build_object('type','image','id',i.id,'url',i.data_url,'alt',u.title) AS b
           FROM site_update_images i WHERE i.update_id = u.id
       ) parts
   )
 WHERE u.blocks = '[]'::jsonb;


-- اعلانِ آپدیت باید بتواند به رکورد آپدیت لینک بدهد؛ جدول اعلان‌ها تا حالا
-- جایی برای ارجاع نداشت (ctaForType فقط از روی type لینک می‌ساخت).
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS ref_id TEXT;

-- ─── AUTH: ثبت‌نام/ورود دومرحله‌ای، مهمان، لاگ ممیزی ──────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS pending_registrations (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  telegram_id TEXT,
  telegram_chat_id TEXT,
  telegram_username TEXT,
  telegram_first_name TEXT,
  telegram_last_name TEXT,
  telegram_photo_file_id TEXT,
  code_hash TEXT,
  code_expires_at TIMESTAMPTZ,
  code_attempts INTEGER NOT NULL DEFAULT 0,
  code_sent_count INTEGER NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,
  step TEXT NOT NULL DEFAULT 'identity',
  locale TEXT,
  source_ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS pending_registrations_step_idx ON pending_registrations(step, created_at DESC);
CREATE INDEX IF NOT EXISTS pending_registrations_expires_idx ON pending_registrations(expires_at);
CREATE INDEX IF NOT EXISTS pending_registrations_telegram_idx ON pending_registrations(telegram_id);

CREATE TABLE IF NOT EXISTS login_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  code_expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS login_challenges_user_idx ON login_challenges(user_id);
CREATE INDEX IF NOT EXISTS login_challenges_expires_idx ON login_challenges(code_expires_at);

ALTER TABLE telegram_link_tokens ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'link';
ALTER TABLE telegram_link_tokens ADD COLUMN IF NOT EXISTS pending_registration_id TEXT;
ALTER TABLE telegram_link_tokens ALTER COLUMN user_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked_until TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS guest_sessions (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  locale TEXT,
  converted_user_id TEXT
);
CREATE INDEX IF NOT EXISTS guest_sessions_expires_idx ON guest_sessions(expires_at);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  reason TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx ON admin_audit_log(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_actor_idx ON admin_audit_log(actor_user_id, created_at DESC);

-- ─── DISCOUNT_CODES / DISCOUNT_REDEMPTIONS — REMOVED FROM POSTGRES ──────────
-- Discount data (codes + redemption audit log) now lives entirely in Google
-- Sheets — see api-server/src/lib/discountStore.ts. Postgres must not hold
-- any of it, so on every boot we make sure these tables are gone (covers
-- databases that were provisioned before this change).
DROP TABLE IF EXISTS discount_redemptions;
DROP TABLE IF EXISTS discount_codes;

-- ─── PLATFORM_SETTINGS (تنظیمات سطح پلتفرم) ─────────────────────────────────
-- key/value ساده برای تنظیماتی که مالک سایت وارد می‌کند و به کاربر یا بات
-- خاصی گره نخورده‌اند — امروز فقط «روش‌های واریز» (آدرس تتر، شماره کارت).
-- ببینید lib/db/src/schema/platformSettings.ts.
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

-- ─── BOT_MANAGERS (دسترسی واگذارشده با کد ادمین) ────────────────────────────
-- ببینید lib/db/src/schema/botManagers.ts. یک ردیف = یک کاربر که با وارد
-- کردن کد ادمینِ یک بات، اجازه‌ی مدیریتش را گرفته. قابل ابطال توسط مالک.
CREATE TABLE IF NOT EXISTS bot_managers (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  granted_via TEXT NOT NULL DEFAULT 'admin_code',
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS bot_managers_bot_user_uniq ON bot_managers(bot_id, user_id);

-- ─── BOT_UPLOAD_SESSIONS («با بات بفرست») ───────────────────────────────────
-- جلسه‌ی کوتاه‌عمری که کاربر محتوا را از داخل تلگرام به سایت می‌دهد.
-- ببینید lib/db/src/schema/uploadSessions.ts.
CREATE TABLE IF NOT EXISTS bot_upload_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bot_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  chat_id TEXT,
  message_id TEXT,
  media_type TEXT,
  file_id TEXT,
  content TEXT,
  entities JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS bot_upload_sessions_chat_idx ON bot_upload_sessions(chat_id, status);

-- ─── تحویل اعلان در تلگرام ──────────────────────────────────────────────────
-- اعلان‌های سایت علاوه بر زنگوله، در بات پلتفرم هم فرستاده می‌شوند؛ این ستون
-- سوئیچ خاموش‌کردنش برای هر کاربر است (پیش‌فرض روشن).
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_telegram BOOLEAN NOT NULL DEFAULT true;

-- ─── backfill: عکس پروفایل تلگرامِ ثبت‌نام‌های با شماره ─────────────────────
-- مسیر ثبت‌نام دومرحله‌ای فقط ستون telegram_photo_file_id را ست می‌کرد و
-- telegram_photo_url و avatar را نه — ولی رابط کاربری از دومی‌ها می‌خواند،
-- پس عکس پروفایل هیچ‌وقت لود نمی‌شد. مسیر ثبت‌نام اصلاح شد؛ این برای
-- حساب‌هایی است که قبلاً ساخته شده‌اند.
UPDATE users
   SET telegram_photo_url = '/api/users/' || id || '/telegram-photo',
       avatar = COALESCE(avatar, '/api/users/' || id || '/telegram-photo')
 WHERE telegram_photo_file_id IS NOT NULL
   AND telegram_photo_file_id <> ''
   AND (telegram_photo_url IS NULL OR telegram_photo_url = '');
`;


/**
 * ایندکس یکتای جزئی روی users.phone + CHECK مالکیت توکن لینک.
 *
 * این دو عمداً از رشته‌ی SQL اصلی جدا هستند: هر کدام می‌توانند روی داده‌ی
 * واقعی شکست بخورند و باید **با صدای بلند** شکست بخورند، نه اینکه بی‌صدا از
 * کنارشان رد شویم. مخصوصاً شماره‌ی تکراری: هیچ ردیفی حذف یا null نمی‌شود —
 * پاک‌سازی باید آگاهانه و دستی انجام شود.
 */
async function postSteps(client) {
  const dupes = await client.query(`
    SELECT phone, count(*)::int AS n
    FROM users WHERE phone IS NOT NULL AND phone <> ''
    GROUP BY phone HAVING count(*) > 1
  `);
  if (dupes.rows.length > 0) {
    console.error(
      "[migrate] Cannot create the unique phone index: duplicate phone numbers exist.\n" +
      "[migrate] No rows were changed. Resolve these first:\n" +
      dupes.rows.map((r) => `  ${r.phone} → ${r.n} users`).join("\n")
    );
    process.exit(1);
  }
  await client.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique_idx ON users(phone) WHERE phone IS NOT NULL"
  );

  // دقیقاً یکی از user_id / pending_registration_id
  await client.query(`
    DO $$ BEGIN
      ALTER TABLE telegram_link_tokens ADD CONSTRAINT telegram_link_tokens_owner_chk
        CHECK ((user_id IS NOT NULL) <> (pending_registration_id IS NOT NULL));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  /**
   * ایمیل بی‌حساس به بزرگی و کوچکی حروف.
   *
   * دو مسیر نوشتن با هم اختلاف داشتند: مسیر ثبت‌نام جدید ایمیل را کوچک می‌کرد
   * و `POST /auth/register` قدیمی دقیقاً همان‌طور که تایپ شده بود ذخیره
   * می‌کرد. Postgres رشته را بایت‌به‌بایت مقایسه می‌کند، پس `Ali@Gmail.com` و
   * `ali@gmail.com` هر دو از کنار قید UNIQUE رد می‌شدند و دو حساب روی یک
   * صندوق پستی واقعی ساخته می‌شد.
   *
   * مثل شماره‌ی بالا: تصادم‌ها اول شمرده و **چاپ** می‌شوند و بعد با خروج
   * غیرصفر متوقف می‌شویم. هیچ حسابی خودکار ادغام یا حذف نمی‌شود — اینکه کدام
   * حساب بماند و ربات‌ها/کیف پول/تیکت‌هایش چه شوند یک تصمیم تجاری است.
   */
  const emailDupes = await client.query(`
    SELECT lower(email) AS email, count(*)::int AS n
    FROM users GROUP BY lower(email) HAVING count(*) > 1
  `);
  if (emailDupes.rows.length > 0) {
    console.error(
      "[migrate] Cannot normalise user e-mails: addresses held by more than one account,\n" +
      "[migrate] differing only in letter case. No rows were changed. Resolve these first:\n" +
      emailDupes.rows.map((r) => `  ${r.email} → ${r.n} users`).join("\n")
    );
    process.exit(1);
  }
  const lowered = await client.query("UPDATE users SET email = lower(email) WHERE email <> lower(email)");
  if (lowered.rowCount > 0) {
    console.log(`[migrate] normalised ${lowered.rowCount} e-mail address(es) to lowercase`);
  }
  // قید ساده‌ی UNIQUE بایت‌به‌بایت است و نمی‌تواند این را بیان کند؛ ایندکس
  // یکتای تابعی می‌تواند، و همان ایندکسی است که جست‌وجوی
  // `lower(email) = $1` هم از آن استفاده می‌کند.
  await client.query("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_unique");
  await client.query("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key");
  await client.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email))"
  );
}

/**
 * پاک‌سازی رکوردهای منقضی.
 *
 * روی Railway کرون جداگانه‌ای وجود ندارد، پس این در **بوت** اجرا می‌شود —
 * همان مسیری که خودِ مایگریشن از آن می‌آید. برای سرویسی که مرتب دیپلوی و
 * ری‌استارت می‌شود کافی است؛ اگر روزی نبود، همین تابع را به یک Railway cron
 * وصل کنید. بدون این، pending_registrations بزرگ‌ترین جدول دیتابیس می‌شود.
 */
async function cleanupExpired(client) {
  const pend = await client.query("DELETE FROM pending_registrations WHERE expires_at < NOW()");
  const guests = await client.query("DELETE FROM guest_sessions WHERE expires_at < NOW()");
  const chall = await client.query(
    "DELETE FROM login_challenges WHERE code_expires_at < NOW() - INTERVAL '1 day'"
  );
  // جلسه‌های «با بات بفرست» عمر کوتاهی دارند و بعدش بی‌مصرف‌اند؛ نگه‌داشتنشان
  // فقط جدول را بزرگ می‌کند.
  const uploads = await client.query(
    "DELETE FROM bot_upload_sessions WHERE expires_at < NOW() - INTERVAL '1 day'"
  );
  console.log(
    `[migrate] cleanup: ${pend.rowCount} pending registrations, ` +
    `${guests.rowCount} guest sessions, ${chall.rowCount} login challenges, ` +
    `${uploads.rowCount} upload sessions`
  );
}

async function migrate() {
  const client = await pool.connect();
  try {
    console.log("[migrate] Running migrations...");
    await client.query(SQL);
    await postSteps(client);
    await cleanupExpired(client);
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
