-- 0048_bot_purge_after.sql
-- انقضا ⇒ حذفِ نهایی: `bots.purge_after` = لحظه‌ای که باتِ منقضی‌شده (تریالِ ۷ روزه / پکیجِ ۳۰ روزه‌یِ تمدید‌نشده) برای
-- همیشه پاک می‌شود (lib/botLifecycle.ts). (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0029..0047.)
ALTER TABLE bots ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_bots_purge_after ON bots(purge_after) WHERE purge_after IS NOT NULL;
UPDATE bots SET tier_expires_at = NOW() + INTERVAL '30 days'
  WHERE tier IN ('standard', 'pro') AND tier_expires_at IS NULL;
