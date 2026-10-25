/**
 * schema/discordBots.ts — بات‌ساز دیسکورد.
 * ستون‌های `runtime_*`، `runner_id` و `lease_until` را فقط سرویس پایتونِ `irforge-dis` می‌نویسد؛
 * سایت فقط `desired_state` / `blueprint` / `restart_nonce` را تغییر می‌دهد و سرویس هر چند ثانیه همگرا می‌شود.
 * مایگریشنِ زمان‌اجرا: api-server/migrate.mjs (آینه: migrations/0061_discord_bots.sql).
 */
import { pgTable, text, timestamp, integer, jsonb, bigserial, primaryKey, index } from "drizzle-orm/pg-core";

export const discordBotsTable = pgTable("discord_bots", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  /** AES-256-GCM (`lib/tokenCrypto.ts`) — هرگز به کلاینت برنمی‌گردد. */
  tokenEnc: text("token_enc"),
  applicationId: text("application_id"),
  botUserId: text("bot_user_id"),
  botUsername: text("bot_username"),
  blueprint: jsonb("blueprint").$type<Record<string, unknown>>().notNull().default({}),
  blueprintVersion: integer("blueprint_version").notNull().default(1),
  /** "running" | "stopped" */
  desiredState: text("desired_state").notNull().default("stopped"),
  /** هر بار که باید اتصال بات از نو ساخته شود (توکن عوض شد / ری‌استارت دستی) +۱ می‌شود. */
  restartNonce: integer("restart_nonce").notNull().default(0),
  /** "active" | "suspended" (توسط سوپرادمین) */
  status: text("status").notNull().default("active"),
  /** "offline" | "starting" | "online" | "error" */
  runtimeState: text("runtime_state").notNull().default("offline"),
  runtimeErrorCode: text("runtime_error_code"),
  runtimeError: text("runtime_error"),
  guildCount: integer("guild_count").notNull().default(0),
  latencyMs: integer("latency_ms"),
  runtimeHeartbeatAt: timestamp("runtime_heartbeat_at", { withTimezone: true }),
  runnerId: text("runner_id"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  syncedHash: text("synced_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => ({
  userIdx: index("discord_bots_user_idx").on(t.userId),
}));

export const discordBotKvTable = pgTable("discord_bot_kv", {
  botId: text("bot_id").notNull(),
  k: text("k").notNull(),
  v: text("v").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.botId, t.k] }) }));

export const discordBotLogsTable = pgTable("discord_bot_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  botId: text("bot_id").notNull(),
  level: text("level").notNull().default("info"),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DiscordBot = typeof discordBotsTable.$inferSelect;
