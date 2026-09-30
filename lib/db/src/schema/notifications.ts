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
  /**
   * ارجاع اختیاری به رکوردی که اعلان درباره‌اش است. فعلاً فقط برای
   * `type = "site_update"` پر می‌شود و مقدارش id همان site update است، تا
   * فرانت بتواند لینک /updates/:id بسازد (قبلاً ctaForType فقط از روی type
   * لینک درمی‌آورد و هیچ راهی برای اشاره به یک رکورد مشخص نبود).
   */
  refId: text("ref_id"),
  /**
   * فاز ۷ "/schools": این جدول تا این‌جا فقط سراسری بود — قدیم‌ترین کامنتِ
   * `schoolAnnouncements.ts` همین را دلیلِ ساختِ یک جدولِ مدرسه‌ایِ جدا
   * می‌دانست، اما نوعِ اعلانِ **شخصی** (آزمون/تکلیف/غیبت/اخطار) دقیقاً همین
   * ستون‌ها (userId/title/message/read) را می‌خواهد و دوباره‌سازیِ زنگوله +
   * صفحه‌ی اعلان‌ها برایِ یک جدولِ جدا اتلافِ کار بود. `schoolId` فقط یک
   * برچسبِ اختیاریِ فیلتر/routing است؛ منطقِ خواندن/خواندن‌شده همان قبلی
   * می‌ماند (ببینید lib/schoolNotify.ts).
   */
  schoolId: text("school_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({ createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;
