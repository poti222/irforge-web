/**
 * schema/schoolAdminMessages.ts — بخش "/schools" فاز ۵ (بندِ ۱): «ارتباط با
 * مدیر».
 * ─────────────────────────────────────────────────────────────────────────
 * تصمیم: به‌جایِ N رشته‌یِ جداگانه به‌ازایِ هر مدیر (که در مدرسه‌هایِ چندمدیره
 * فقط سردرگمی/پیامِ تکراری می‌سازد و معلوم نیست دانش‌آموز کدام مدیر را انتخاب
 * کند)، یک رشته‌یِ مشترک به‌ازایِ هر (schoolId, studentMemberId) که همه‌یِ
 * مدیرهایِ همان مدرسه (school_admins + عضوِ اصلیِ role="admin") می‌بینند و
 * پاسخ می‌دهند — برخلافِ چتِ مشاور (schoolCounselorMessages)، این ارتباط اصلاً
 * قرار نیست محرمانه/۱:۱ باشد، پس هیچ ستونِ adminUserId ثابتی لازم نیست.
 * فازِ ۵ (بندِ ۲) همینجا را برایِ والدِ همان دانش‌آموز هم قابلِ‌خواندن/نوشتن
 * می‌کند (ببینید routes/schoolAdminMessages.ts) — به‌جایِ ساختنِ یک سیستمِ
 * پیام‌رسانیِ کاملاً جدا برایِ والد.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { schoolsTable } from "./schools";

export const schoolAdminMessagesTable = pgTable("school_admin_messages", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schoolsTable.id),
  /** ارجاع به `school_members.id` دانش‌آموز — کلیدِ رشته، نه یک مدیرِ خاص */
  studentMemberId: text("student_member_id").notNull(),
  /** فرستنده — یکی از مدیرهایِ مدرسه، یا خودِ دانش‌آموز، یا (فازِ ۵ بندِ ۲) والدش */
  senderUserId: text("sender_user_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSchoolAdminMessageSchema = createInsertSchema(schoolAdminMessagesTable).omit({ createdAt: true });
export type SchoolAdminMessage = typeof schoolAdminMessagesTable.$inferSelect;
export type InsertSchoolAdminMessage = z.infer<typeof insertSchoolAdminMessageSchema>;
