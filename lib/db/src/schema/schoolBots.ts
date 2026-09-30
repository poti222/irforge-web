/**
 * schema/schoolBots.ts — بخش "/schools" فاز ۷ (بخش A): استخرِ توکنِ بات و
 * باتِ اطلاع‌رسانیِ هر مدرسه.
 * ─────────────────────────────────────────────────────────────────────────
 * دقیقاً همان الگویِ `sheetPool.ts`/`sheetPoolTable`: سوپرادمین چند توکنِ بات
 * تلگرامیِ آماده (از BotFather) به این استخر اضافه می‌کند؛ وقتی یک مدرسه
 * «بات اطلاع‌رسانی» را می‌خرد، یک ردیفِ "available" اتمیک گرفته و "assigned"
 * می‌شود (ببینید claimFreeSchoolBotToken در routes/schoolBots.ts، همان
 * الگویِ claimFreeSheet در routes/bots.ts با FOR UPDATE SKIP LOCKED).
 *
 * `botToken` دقیقاً مثلِ `bots.token` رمزنگاری‌شده ذخیره می‌شود
 * (encryptToken/decryptToken در lib/tokenCrypto.ts) — هرگز متنِ خام.
 */
import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { schoolsTable } from "./schools";

export const schoolBotTokenPoolTable = pgTable("school_bot_token_pool", {
  id: text("id").primaryKey(),

  /** توکنِ بات تلگرامی — رمزنگاری‌شده با encryptToken، هرگز متنِ خام. */
  botToken: text("bot_token").notNull(),

  /**
   * وضعیت:
   *   available → آزاد، قابلِ اختصاص به یک مدرسه
   *   assigned  → به یک مدرسه داده شده (ببینید assignedSchoolId)
   */
  status: text("status").notNull().default("available"),

  /** مدرسه‌ای که این توکن به آن اختصاص یافته — nullable تا assigned شود. */
  assignedSchoolId: text("assigned_school_id").references(() => schoolsTable.id),

  /** سوپرادمینی که این توکن را به استخر اضافه کرده. */
  addedByUserId: text("added_by_user_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/**
 * باتِ فعالِ یک مدرسه — دقیقاً یک ردیف به‌ازایِ هر مدرسه (schoolId یکتاست).
 * `botTokenPoolId` رفرنسِ همان ردیفِ استخر است که مصرف شد؛ `telegramBotId`/
 * `telegramUsername` بعد از فراخوانیِ getMe (fetchBotIdentity در
 * lib/telegram.ts) پر می‌شوند — تا آن لحظه nullable می‌مانند (best-effort،
 * شکستِ فراخوانیِ تلگرام نباید کل خریدِ کیف‌پول را rollback کند).
 */
export const schoolBotsTable = pgTable("school_bots", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().unique().references(() => schoolsTable.id),
  botTokenPoolId: text("bot_token_pool_id").notNull().references(() => schoolBotTokenPoolTable.id),
  telegramBotId: text("telegram_bot_id"),
  telegramUsername: text("telegram_username"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * کاربرانی که با `/start <token>` وارد باتِ **مدرسه‌شان** شده‌اند و
 * chat_id شان برای ارسالِ اعلان ثبت شده — بدونِ این ردیف تلگرام اجازه‌ی
 * DM نمی‌دهد (ببینید schoolBotLinkTokens.ts + routes/schoolBotWebhook.ts).
 * یک کاربر می‌تواند به چند بات مدرسه وصل باشد (مثلاً والدی با چند فرزند در
 * چند مدرسه)، پس یکتایی رویِ (schoolBotId, userId) است نه فقط userId.
 */
export const schoolBotSubscribersTable = pgTable("school_bot_subscribers", {
  id: text("id").primaryKey(),
  schoolBotId: text("school_bot_id").notNull().references(() => schoolBotsTable.id),
  userId: text("user_id").notNull(),
  telegramChatId: text("telegram_chat_id").notNull(),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * توکنِ یک‌بارمصرفِ لینکِ عمیق `/start <token>` برایِ وصل‌شدن به باتِ یک
 * مدرسه — کپیِ حداقلیِ الگویِ `telegramLinkTokensTable`، اما مخصوصِ بات‌هایِ
 * مدرسه (که هرکدام توکن/webhook مجزا دارند، پس نمی‌توانند از همان جدول/
 * webhookِ باتِ پلتفرم استفاده کنند). کاربر همیشه از قبل لاگین است، پس برخلافِ
 * telegramLinkTokensTable نیازی به purpose/pendingRegistrationId نیست.
 */
export const schoolBotLinkTokensTable = pgTable("school_bot_link_tokens", {
  token: text("token").primaryKey(),
  schoolBotId: text("school_bot_id").notNull().references(() => schoolBotsTable.id),
  userId: text("user_id").notNull(),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const insertSchoolBotTokenPoolSchema = createInsertSchema(schoolBotTokenPoolTable).omit({ createdAt: true, updatedAt: true });
export const insertSchoolBotSchema = createInsertSchema(schoolBotsTable).omit({ createdAt: true, assignedAt: true });
export const insertSchoolBotSubscriberSchema = createInsertSchema(schoolBotSubscribersTable).omit({ linkedAt: true });

export type SchoolBotTokenPool = typeof schoolBotTokenPoolTable.$inferSelect;
export type SchoolBot = typeof schoolBotsTable.$inferSelect;
export type SchoolBotSubscriber = typeof schoolBotSubscribersTable.$inferSelect;
export type SchoolBotLinkToken = typeof schoolBotLinkTokensTable.$inferSelect;
export type InsertSchoolBotTokenPool = z.infer<typeof insertSchoolBotTokenPoolSchema>;
export type InsertSchoolBot = z.infer<typeof insertSchoolBotSchema>;
export type InsertSchoolBotSubscriber = z.infer<typeof insertSchoolBotSubscriberSchema>;
