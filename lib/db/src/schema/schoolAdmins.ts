/**
 * schema/schoolAdmins.ts — بخش "/schools" فاز ۲: پشتیبانیِ چندمدرسه‌ای برایِ
 * مدیر (many-to-many).
 * ─────────────────────────────────────────────────────────────────────────
 * `school_members` عمداً دست‌نخورده می‌ماند: همچنان دقیقاً یک ردیف به ازایِ
 * هر کاربر و همان چیزی است که آنبوردینگ/ویزاردِ نقش/دروازه‌یِ SchoolShell
 * رویش حساب می‌کنند («کاربرِ جاری الان عضوِ کدوم مدرسه‌ست»). این جدولِ جدا
 * فقط یک لیستِ اضافه‌ست: «این مدیر، مدیرِ کدوم مدرسه‌های دیگه هم هست» —
 * ساده‌ترین و کم‌ریسک‌ترین راه برایِ سوییچرِ «مدرسه‌های من» بدونِ دست‌زدن به
 * قراردادهایِ فاز ۱. هر ردیف یعنی «این کاربر روی این مدرسه هم نقشِ admin
 * دارد» (مستقل از این‌که `school_members.school_id`ش کدام است).
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { schoolsTable } from "./schools";

export const schoolAdminsTable = pgTable("school_admins", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  schoolId: text("school_id").notNull().references(() => schoolsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSchoolAdminSchema = createInsertSchema(schoolAdminsTable).omit({ createdAt: true });
export type SchoolAdmin = typeof schoolAdminsTable.$inferSelect;
export type InsertSchoolAdmin = z.infer<typeof insertSchoolAdminSchema>;
