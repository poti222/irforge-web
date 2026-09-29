-- 0032_card_autoconfirm_p8_p9.sql
-- Phase 8 (platform wallet top-up migration refs) + Phase 9 (event log).
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it for
-- drizzle-kit parity, same convention as 0025-0031.)

-- ─── CARD_AUTOCONFIRM_P8_P9 (مهاجرتِ شارژ کیف‌پولِ پلتفرم + لاگِ رویدادها) ────────
-- legacy_ref: ردیف‌های مهاجرت‌شده از wallet_topups / sms_logs با کلیدِ یکتا («جدول:id»)
-- تا اسکریپتِ مهاجرت idempotent باشد و هیچ ردیفِ قدیمی یتیم نماند.
-- قیدِ suffix برای ردیف‌های legacy معاف است: پسوندِ قدیمی (۱۰۰۰..۹۹۹۹ ریال) مضربِ ۱۰ نبود
-- و مبلغِ نهایی‌اش باید دقیقاً همان بماند تا پیامکِ در راه هنوز match شود.
-- payment_events: لاگِ تفصیلیِ سوپرادمین. هرگز متنِ خامِ پیامک یا شماره‌کارتِ کامل ندارد.

ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS legacy_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS payment_requests_legacy_ref_uk
  ON payment_requests (legacy_ref) WHERE legacy_ref IS NOT NULL;
ALTER TABLE sms_inbox ADD COLUMN IF NOT EXISTS legacy_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS sms_inbox_legacy_ref_uk
  ON sms_inbox (legacy_ref) WHERE legacy_ref IS NOT NULL;

DO $$
DECLARE def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'payment_requests_suffix_chk' AND conrelid = 'payment_requests'::regclass;
  IF def IS NULL OR position('legacy_ref' IN def) = 0 THEN
    IF def IS NOT NULL THEN
      ALTER TABLE payment_requests DROP CONSTRAINT payment_requests_suffix_chk;
    END IF;
    ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_suffix_chk CHECK (
      suffix_rial = 0 OR legacy_ref IS NOT NULL
      OR (channel_kind <> 'fixed_link' AND suffix_rial % 10 = 0 AND suffix_rial <= 9990)
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  level TEXT NOT NULL DEFAULT 'info',
  kind TEXT NOT NULL,
  scope TEXT,
  bot_id TEXT,
  channel_id TEXT,
  request_id TEXT,
  sms_id TEXT,
  actor TEXT,
  message TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT payment_events_level_chk CHECK (level IN ('info', 'warn', 'error'))
);
CREATE INDEX IF NOT EXISTS idx_payment_events_at ON payment_events(at);
CREATE INDEX IF NOT EXISTS idx_payment_events_request ON payment_events(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_events_channel ON payment_events(channel_id, at);
CREATE INDEX IF NOT EXISTS idx_payment_events_problems ON payment_events(at) WHERE level <> 'info';
