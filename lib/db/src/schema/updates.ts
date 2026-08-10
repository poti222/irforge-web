/**
 * schema/updates.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * «آپدیت‌های سایت» — تغییرات و امکانات جدیدی که ادمین منتشر می‌کند.
 *
 * این با `announcements` فرق دارد: announcements یک نوار کوتاه و گذرا بالای
 * داشبورد است، ولی یک site update یک رکورد ماندگار با متن بلند و چند عکس
 * است که (۱) یک‌بار به‌صورت مودال به هر کاربر نشان داده می‌شود، (۲) برای هر
 * کاربر یک notification با `type = "site_update"` می‌سازد، و (۳) در صفحه‌ی
 * /updates به‌عنوان تاریخچه باقی می‌ماند.
 *
 * عکس‌ها عمداً در جدول جدا هستند: لیست آپدیت‌ها نباید مجبور باشد چند مگابایت
 * data-URL بیس‌۶۴ حمل کند؛ فقط endpoint جزئیات آن‌ها را می‌خواند.
 */
import { pgTable, text, timestamp, boolean, integer, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const siteUpdatesTable = pgTable("site_updates", {
  id: text("id").primaryKey(),
  /** اختیاری، مثل "v1.4" */
  version: text("version"),
  title: text("title").notNull(),
  /** متن ساده؛ خط جدیدها با whitespace-pre-wrap رندر می‌شوند */
  body: text("body").notNull(),
  /** پیش‌نویس تا وقتی ادمین Publish بزند */
  published: boolean("published").notNull().default(false),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const siteUpdateImagesTable = pgTable("site_update_images", {
  id: text("id").primaryKey(),
  updateId: text("update_id").notNull(),
  /** data:image/...;base64,... — همان الگوی رسید کیف پول */
  dataUrl: text("data_url").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** چه کسی کدام آپدیت را دیده — منبع حقیقت برای «مودال فقط یک‌بار». */
export const userUpdateViewsTable = pgTable(
  "user_update_views",
  {
    userId: text("user_id").notNull(),
    updateId: text("update_id").notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.updateId] }),
  }),
);

export const insertSiteUpdateSchema = createInsertSchema(siteUpdatesTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertSiteUpdate = z.infer<typeof insertSiteUpdateSchema>;
export type SiteUpdate = typeof siteUpdatesTable.$inferSelect;
export type SiteUpdateImage = typeof siteUpdateImagesTable.$inferSelect;
export type UserUpdateView = typeof userUpdateViewsTable.$inferSelect;
