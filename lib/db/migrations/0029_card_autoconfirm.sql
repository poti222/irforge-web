-- 0029_card_autoconfirm.sql
-- Shared card-to-card module with SMS auto-confirm (platform + bot scopes).
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it for
-- drizzle-kit parity, same convention as 0025-0028.)

-- ─── CARD_AUTOCONFIRM (کارت‌به‌کارت با تأیید خودکار از روی پیامک بانک) ─────
-- ماژول مشترک: scope=platform (شارژ کیف‌پول IrForge) و scope=bot (فروش داخل
-- باتِ یک فروشنده). همه‌ی مبالغ عدد صحیحِ ریال (BIGINT) هستند. یکتاییِ مبلغ و
-- «هر پیامک فقط یک‌بار» در سطح دیتابیس enforce می‌شود، نه فقط در اپلیکیشن.
-- bot_id عمداً FOREIGN KEY ندارد: purgeBotFully ردیفِ بات را حذف می‌کند و
-- سابقه‌ی مالی نباید با آن پاک شود یا جلوی حذف را بگیرد.

CREATE TABLE IF NOT EXISTS payment_channels (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  bot_id TEXT,
  kind TEXT NOT NULL,
  card_number_enc TEXT,
  holder_name TEXT,
  bank_name TEXT,
  payment_url TEXT,
  sms_secret_hash TEXT NOT NULL,
  sender_allowlist TEXT[] NOT NULL DEFAULT '{}',
  bank_parser TEXT NOT NULL DEFAULT 'blubank',
  min_amount_rial BIGINT NOT NULL DEFAULT 1000000,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_sms_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_channels_scope_chk CHECK (scope IN ('platform', 'bot')),
  CONSTRAINT payment_channels_scope_bot_chk CHECK ((scope = 'bot') = (bot_id IS NOT NULL)),
  CONSTRAINT payment_channels_kind_chk CHECK (kind IN ('card_manual', 'fixed_link', 'open_link')),
  CONSTRAINT payment_channels_kind_fields_chk CHECK (
    (kind = 'card_manual' AND card_number_enc IS NOT NULL)
    OR (kind IN ('fixed_link', 'open_link') AND payment_url IS NOT NULL)
  ),
  CONSTRAINT payment_channels_min_amount_chk CHECK (min_amount_rial > 0)
);
CREATE INDEX IF NOT EXISTS idx_payment_channels_scope_bot ON payment_channels(scope, bot_id);

CREATE TABLE IF NOT EXISTS payment_requests (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES payment_channels(id),
  channel_kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  bot_id TEXT,
  user_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  order_id TEXT,
  base_amount_rial BIGINT NOT NULL,
  suffix_rial BIGINT NOT NULL DEFAULT 0,
  final_amount_rial BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ,
  queue_position INTEGER,
  receipt_file_id TEXT,
  receipt_uploaded_at TIMESTAMPTZ,
  confirmed_by TEXT,
  confirmed_by_admin_id TEXT,
  matched_sms_id TEXT,
  confirmed_at TIMESTAMPTZ,
  account_id_snapshot TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_requests_status_chk CHECK (
    status IN ('queued', 'pending', 'awaiting_review', 'confirmed', 'expired', 'canceled', 'rejected')
  ),
  CONSTRAINT payment_requests_kind_chk CHECK (channel_kind IN ('card_manual', 'fixed_link', 'open_link')),
  CONSTRAINT payment_requests_scope_chk CHECK (scope IN ('platform', 'bot')),
  CONSTRAINT payment_requests_scope_bot_chk CHECK ((scope = 'bot') = (bot_id IS NOT NULL)),
  CONSTRAINT payment_requests_purpose_chk CHECK (purpose IN ('wallet_topup', 'order')),
  CONSTRAINT payment_requests_order_chk CHECK ((purpose = 'order') = (order_id IS NOT NULL)),
  CONSTRAINT payment_requests_amounts_chk CHECK (
    base_amount_rial > 0 AND suffix_rial >= 0 AND final_amount_rial >= base_amount_rial
    AND final_amount_rial = base_amount_rial + suffix_rial
  ),
  CONSTRAINT payment_requests_suffix_chk CHECK (
    suffix_rial = 0 OR (channel_kind <> 'fixed_link' AND suffix_rial % 10 = 0 AND suffix_rial <= 9990)
  ),
  CONSTRAINT payment_requests_expiry_chk CHECK (status <> 'pending' OR expires_at IS NOT NULL),
  CONSTRAINT payment_requests_queue_chk CHECK ((status = 'queued') = (queue_position IS NOT NULL)),
  CONSTRAINT payment_requests_confirm_chk CHECK (
    (status = 'confirmed') = (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
  ),
  CONSTRAINT payment_requests_confirm_by_chk CHECK (
    confirmed_by IS NULL OR confirmed_by IN ('sms', 'admin')
  ),
  CONSTRAINT payment_requests_confirm_admin_chk CHECK (
    confirmed_by IS DISTINCT FROM 'admin' OR confirmed_by_admin_id IS NOT NULL
  )
);
-- دو درخواستِ فعال روی یک کانال هرگز مبلغ نهاییِ یکسان ندارند (حتی زیر بارِ هم‌زمان).
CREATE UNIQUE INDEX IF NOT EXISTS payment_requests_active_final_uk
  ON payment_requests (channel_id, final_amount_rial)
  WHERE status IN ('pending', 'awaiting_review');
-- لینکِ مبلغ-ثابت: حداکثر یک درخواستِ pending به‌ازای هر مبلغ، بقیه queued.
CREATE UNIQUE INDEX IF NOT EXISTS payment_requests_fixed_pending_uk
  ON payment_requests (channel_id, base_amount_rial)
  WHERE status = 'pending' AND channel_kind = 'fixed_link';
CREATE INDEX IF NOT EXISTS idx_payment_requests_channel_status ON payment_requests(channel_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_requests_owner ON payment_requests(scope, bot_id, user_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_order ON payment_requests(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_requests_pending_expiry ON payment_requests(expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_payment_requests_queue
  ON payment_requests(channel_id, base_amount_rial, queue_position) WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS sms_inbox (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES payment_channels(id),
  raw_text TEXT NOT NULL,
  sender TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content_hash TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'unknown',
  amount_rial BIGINT,
  balance_rial BIGINT,
  parsed_ok BOOLEAN NOT NULL DEFAULT FALSE,
  matched_request_id TEXT REFERENCES payment_requests(id),
  status TEXT NOT NULL DEFAULT 'unmatched',
  CONSTRAINT sms_inbox_direction_chk CHECK (direction IN ('deposit', 'withdraw', 'unknown')),
  CONSTRAINT sms_inbox_status_chk CHECK (status IN ('unmatched', 'matched', 'ambiguous', 'ignored')),
  CONSTRAINT sms_inbox_amounts_chk CHECK (
    (amount_rial IS NULL OR amount_rial > 0) AND (balance_rial IS NULL OR balance_rial >= 0)
  ),
  CONSTRAINT sms_inbox_parsed_chk CHECK (
    NOT parsed_ok OR (direction <> 'unknown' AND amount_rial IS NOT NULL)
  ),
  CONSTRAINT sms_inbox_matched_chk CHECK (
    (status = 'matched') = (matched_request_id IS NOT NULL)
  ),
  CONSTRAINT sms_inbox_matched_deposit_chk CHECK (
    status <> 'matched' OR (parsed_ok AND direction = 'deposit')
  )
);
-- idempotency: ارسالِ دوباره‌ی همان پیامک روی یک کانال هیچ ردیفِ تازه‌ای نمی‌سازد.
CREATE UNIQUE INDEX IF NOT EXISTS sms_inbox_channel_hash_uk ON sms_inbox (channel_id, content_hash);
-- هر درخواست حداکثر به یک پیامک وصل می‌شود.
CREATE UNIQUE INDEX IF NOT EXISTS sms_inbox_matched_request_uk ON sms_inbox (matched_request_id) WHERE matched_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sms_inbox_channel_status ON sms_inbox(channel_id, status, received_at);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_requests_matched_sms_fk') THEN
    ALTER TABLE payment_requests
      ADD CONSTRAINT payment_requests_matched_sms_fk FOREIGN KEY (matched_sms_id) REFERENCES sms_inbox(id);
  END IF;
END $$;
