-- 0016_site_updates.sql
-- فیچر «آپدیت‌های سایت»: ادمین یک آپدیت با متن و چند عکس می‌سازد، منتشرش
-- می‌کند، و هر کاربر یک‌بار در داشبورد مودالش را می‌بیند.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0015_announcements.sql.)

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

-- اعلانِ آپدیت باید بتواند به رکورد آپدیت لینک بدهد.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS ref_id TEXT;
