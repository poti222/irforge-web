/**
 * schema/notifications.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * سیستم اعلان‌های جدید سایت — جدا از `activity` (که یک فید فقط-خواندنیِ
 * تاریخچه‌ست) و `announcements` (که سراسری‌ست، مخصوص یک کاربر نیست).
 *
 * این جدول per-user است و read/unread دارد. اولین مصرف‌کننده‌اش هشدارهای
 * تریال ۷ روزه است (trial_warning / trial_expired) ولی برای هر نوع اعلان
 * آینده هم قابل استفاده‌ست.
 *
 * چون سرور cron/scheduled job ندارد، این ردیف‌ها به‌صورت lazy (موقع
 * درخواست‌های GET /bots، GET /bots/:id و GET /notifications) تولید
 * می‌شوند — نه با یک job دوره‌ای. dedupeKey برای جلوگیری از تکرار همان
 * اعلان (مثلاً «۳ روز مانده») در چند درخواست پشت‌سرهم است.
 */
import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const notificationsTable = pgTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  botId: text("bot_id"),
  /** trial_warning | trial_expired | (آینده: سایر انواع) */
  type: text("type").notNull(),
  /** info | warning | critical — برای رنگ/آیکون سمت فرانت */
  severity: text("severity").notNull().default("info"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  read: boolean("read").notNull().default(false),
  dedupeKey: text("dedupe_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({ createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;
