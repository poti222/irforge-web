-- 0027_plan_consolidation_bot_tier.sql
-- Consolidate the account subscription plans (Silver/Gold/Diamond) into the
-- same 2 tiers as the bot-purchase packages (Standard/Pro), and persist a
-- bot's purchased tier so it can be shown/changed after the fact.
-- (Runtime migration lives in api-server/migrate.mjs; this file mirrors it
-- for drizzle-kit parity, same convention as 0025/0026.)

UPDATE user_plans SET plan_id = 'gold' WHERE plan_id = 'diamond';
UPDATE users SET plan = 'gold' WHERE plan = 'diamond';

UPDATE plans SET
  name = 'Standard', price = 500000, price_usd = NULL,
  max_bots = 1, max_plugins = 3, max_users = 50, ram_gb = 1, cpu_cores = 1, popular = false
WHERE id = 'silver';

UPDATE plans SET
  name = 'Pro', price = 1100000, price_usd = NULL,
  max_bots = 3, max_plugins = 6, max_users = 250, ram_gb = 3, cpu_cores = 3, popular = true
WHERE id = 'gold';

UPDATE user_plans SET plan_name = 'Standard' WHERE plan_id = 'silver';
UPDATE user_plans SET plan_name = 'Pro' WHERE plan_id = 'gold';

DELETE FROM plans WHERE id = 'diamond';

INSERT INTO plans (id, name, price, price_usd, interval, features, max_bots, max_plugins, max_users, ram_gb, cpu_cores, popular)
VALUES
  ('silver', 'Standard', 500000,  NULL, 'monthly', '{}', 1, 3, 50,  1, 1, false),
  ('gold',   'Pro',      1100000, NULL, 'monthly', '{}', 3, 6, 250, 3, 3, true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE bots ADD COLUMN IF NOT EXISTS tier TEXT;
