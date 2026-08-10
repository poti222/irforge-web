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
  /**
   * برای `purpose: "link"` پر است (کاربر لاگین‌کرده). برای `purpose: "register"`
   * هنوز کاربری وجود ندارد، پس null است و به‌جایش pendingRegistrationId پر
   * می‌شود. دقیقاً یکی از این دو باید ست باشد — در مایگریشن با CHECK تضمین
   * شده، نه فقط با قرارداد.
   */
  userId: text("user_id"),
  /** link | register */
  purpose: text("purpose").notNull().default("link"),
  pendingRegistrationId: text("pending_registration_id"),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type TelegramLinkToken = typeof telegramLinkTokensTable.$inferSelect;
