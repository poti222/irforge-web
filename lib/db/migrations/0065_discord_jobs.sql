-- Scheduled actions for Discord bots (reminders, giveaways, tempbans, ticket auto-close …).
CREATE TABLE IF NOT EXISTS discord_bot_jobs (
  id BIGSERIAL PRIMARY KEY,
  bot_id TEXT NOT NULL,
  job_key TEXT,
  run_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS discord_bot_jobs_due_idx ON discord_bot_jobs(bot_id, run_at);
CREATE INDEX IF NOT EXISTS discord_bot_jobs_key_idx ON discord_bot_jobs(bot_id, job_key);
