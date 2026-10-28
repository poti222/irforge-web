-- «ارسال پیامک به تلگرام»: برنامه‌ی پیامک‌خوانِ گوشی (MacroDroid و …) هر پیامکِ انتخاب‌شده را به
-- *یک* وبهوکِ هر اکانت می‌فرستد؛ سایت با قانون‌ها تصمیم می‌گیرد پیام به کدام مقصدِ تلگرام برود.
-- یک ردیف در sms_forward_accounts = یک وبهوک برایِ کلِ اکانت (نه به‌ازای هر مقصد).
CREATE TABLE IF NOT EXISTS sms_forward_accounts (
  user_id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  secret_hash TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  bot_token_enc TEXT,
  bot_username TEXT,
  userbot_session_enc TEXT,
  userbot_label TEXT,
  last_received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sms_forward_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sender_filter TEXT[] NOT NULL DEFAULT '{}',
  keyword TEXT,
  via TEXT NOT NULL DEFAULT 'bot',
  chat_ref TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sms_forward_rules_via_chk CHECK (via IN ('bot', 'userbot', 'both'))
);
CREATE INDEX IF NOT EXISTS idx_sms_forward_rules_user ON sms_forward_rules(user_id, sort_order);

-- لاگِ تحویل: عمداً بدونِ متنِ پیامک (ممکن است کد/مبلغ داشته باشد) — فقط فرستنده، طول و نتیجه.
CREATE TABLE IF NOT EXISTS sms_forward_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  rule_id TEXT,
  rule_name TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sender TEXT,
  content_hash TEXT NOT NULL,
  text_len INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  via TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_sms_forward_log_user_time ON sms_forward_log(user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_forward_log_dedupe ON sms_forward_log(user_id, content_hash, received_at DESC);

-- قفلِ اتمیکِ ضدِ ارسالِ چندباره‌ی یک پیامک (کلیدِ یکتا = اکانت + هشِ محتوا).
CREATE TABLE IF NOT EXISTS sms_forward_claim (
  user_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, content_hash)
);
