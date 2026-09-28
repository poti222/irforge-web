/**
 * schema/schoolContent.ts — محتوایِ آموزشیِ بخش «/schools» (لغت‌نامه/جزوه/کتاب/فرمول).
 * ─────────────────────────────────────────────────────────────────────────
 * برخلافِ ریپوی dars (که این داده روی Google Sheets و به‌صورتِ فلش‌کارتِ
 * ساده بود)، اینجا یک جدولِ واقعیِ Postgres با CRUD است — طبق دستورِ کاربر:
 * فقط *ساختار* از dars گرفته شود، نه دیتا/کدِ Sheets.
 *
 * `schoolId` عمداً nullable است: محتوا می‌تواند سطحِ کل پلتفرم باشد (مثلاً
 * یک لغت‌نامه‌ی عمومیِ فارسی-انگلیسی که همه‌ی مدرسه‌ها می‌بینند) یا مختصِ یک
 * مدرسه (مثلاً جزوه‌ی معلمِ همان مدرسه). null یعنی «عمومی/همه‌ی مدرسه‌ها».
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/** type های ممکن: "dictionary" | "note" | "book" | "formula" */
export const SCHOOL_CONTENT_TYPES = ["dictionary", "note", "book", "formula"] as const;
export type SchoolContentType = (typeof SCHOOL_CONTENT_TYPES)[number];

export const schoolContentItemsTable = pgTable("school_content_items", {
  id: text("id").primaryKey(),
  /** null = محتوایِ عمومیِ پلتفرم، در غیر این صورت مختصِ همان مدرسه */
  schoolId: text("school_id"),
  /** type های ممکن: "dictionary" | "note" | "book" | "formula" */
  type: text("type").notNull(),
  title: text("title").notNull(),
  /**
   * می‌تواند markdown/متنِ حاویِ LaTeX باشد — برایِ type="formula" با KaTeX
   * روی فرانت رندر می‌شود (ببینید irforge/src/components/schools/FormulaBody.tsx).
   */
  body: text("body").notNull().default(""),
  /** فقط برای لغت‌نامه معنا دارد — "fa" | "en" | ... */
  language: text("language"),
  createdByUserId: text("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSchoolContentItemSchema = createInsertSchema(schoolContentItemsTable).omit({ createdAt: true, updatedAt: true });
export type SchoolContentItem = typeof schoolContentItemsTable.$inferSelect;
export type InsertSchoolContentItem = z.infer<typeof insertSchoolContentItemSchema>;
