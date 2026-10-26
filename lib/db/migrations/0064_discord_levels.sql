-- XP / leveling for Discord bots: one row per (bot, guild, user).
CREATE TABLE IF NOT EXISTS discord_bot_levels (
  bot_id TEXT NOT NULL,
  guild_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  xp BIGINT NOT NULL DEFAULT 0,
  last_gain_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bot_id, guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS discord_bot_levels_top_idx ON discord_bot_levels(bot_id, guild_id, xp DESC);
