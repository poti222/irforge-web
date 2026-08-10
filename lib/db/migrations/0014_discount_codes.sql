-- 0014_discount_codes.sql
-- Phase 9: کدهای تخفیف (schema + API).
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0013_bot_avatar_file_id.sql.)

CREATE TABLE IF NOT EXISTS discount_codes (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,           -- همیشه UPPERCASE ذخیره می‌شود
  kind text NOT NULL,                  -- percent | fixed
  value integer NOT NULL,              -- percent: 1-100 | fixed: مبلغ تومان
  max_uses integer,                    -- null = نامحدود
  used_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,              -- null = بدون انقضا
  active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS discount_redemptions (
  id text PRIMARY KEY,
  code_id text NOT NULL,
  user_id text NOT NULL,
  order_amount integer NOT NULL,
  discount_amount integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discount_redemptions_code_id_idx ON discount_redemptions(code_id);
CREATE INDEX IF NOT EXISTS discount_redemptions_user_id_idx ON discount_redemptions(user_id);
