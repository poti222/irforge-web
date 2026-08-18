-- 0020_telegram_login_requests.sql
-- ورود یک‌کلیکی با تلگرام: کاربر روی سایت دکمه را می‌زند، وارد بات می‌شود، و
-- بات او را از روی telegram_id خودِ تلگرام می‌شناسد و ورود را تأیید می‌کند.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it for
-- drizzle-kit parity, same convention as 0017_auth_guest_admin.sql.)

CREATE TABLE IF NOT EXISTS telegram_login_requests (
  -- همان چیزی که در لینک عمیق `/start tglogin_<id>` می‌رود؛ عمومی فرض می‌شود.
  id TEXT PRIMARY KEY,
  -- فقط مرورگر آغازکننده دارد. بدون این، هرکس لینک را ببیند نشست را می‌گیرد.
  poll_secret TEXT NOT NULL,
  -- pending | approved | consumed | rejected
  status TEXT NOT NULL DEFAULT 'pending',
  user_id TEXT,
  -- یک‌بارمصرف، فقط برای دکمه‌ی «داشبورد» داخل پیام بات. بعد از تأیید ساخته
  -- می‌شود، نه قبلش.
  web_ticket TEXT,
  web_ticket_used_at TIMESTAMPTZ,
  rejected_reason TEXT,
  locale TEXT,
  -- فقط برای بررسی سوءاستفاده؛ هرگز در پاسخی برنمی‌گردد.
  source_ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS telegram_login_requests_expires_idx
  ON telegram_login_requests(expires_at);

-- تبادل تیکت یک SELECT دقیق روی این ستون است، پس باید یکتا باشد. ایندکس
-- **جزئی** است چون تا پیش از تأیید، web_ticket خالی است.
CREATE UNIQUE INDEX IF NOT EXISTS telegram_login_requests_ticket_idx
  ON telegram_login_requests(web_ticket) WHERE web_ticket IS NOT NULL;
