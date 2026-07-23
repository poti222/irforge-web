/**
 * schema/telegramLinkTokens.ts
 *
 * یک‌بارمصرف‌توکن‌هایی که موقع زدن دکمه‌ی «اتصال با ربات» توی پروفایل ساخته
 * می‌شن. کاربر با لینک عمیق `https://t.me/<bot>?start=<token>` وارد بات
 * می‌شه، بات با /start <token> این ردیف رو پیدا می‌کنه و حساب رو وصل می‌کنه.
 * ببین routes/telegramWebhook.ts.
 */
import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const telegramLinkTokensTable = pgTable("telegram_link_tokens", {
  token: text("token").primaryKey(),
  userId: text("user_id").notNull(),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type TelegramLinkToken = typeof telegramLinkTokensTable.$inferSelect;
