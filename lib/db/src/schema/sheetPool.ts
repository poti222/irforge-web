/**
 * schema/sheetPool.ts
 * GROUP 2 MIGRATION — جدول جدید
 * لیست ID های گوگل شیت آماده که سوپرادمین اضافه می‌کنه.
 * هر بار بات تأیید می‌شه، یک ردیف "available" گرفته و "assigned" می‌شه.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const sheetPoolTable = pgTable("sheet_pool", {
  id: text("id").primaryKey(),

  /** Google Spreadsheet ID */
  sheetId: text("sheet_id").notNull().unique(),

  /**
   * وضعیت:
   *   available → آزاد، قابل اختصاص
   *   assigned  → به یک بات داده شده
   */
  status: text("status").notNull().default("available"),

  /** ID بات مرتبط (nullable تا assigned بشه) */
  assignedBotId: text("assigned_bot_id"),

  /** سوپرادمینی که این شیت رو اضافه کرده */
  addedBy: text("added_by"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSheetPoolSchema = createInsertSchema(sheetPoolTable).omit({ createdAt: true, updatedAt: true });
export type InsertSheetPool = z.infer<typeof insertSheetPoolSchema>;
export type SheetPool = typeof sheetPoolTable.$inferSelect;
