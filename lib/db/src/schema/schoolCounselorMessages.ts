/**
 * schema/schoolCounselorMessages.ts — بخش "/schools" فاز ۴ (بندِ ۱): چتِ
 * یک‌به‌یکِ مشاور↔دانش‌آموز («ارتباط با مشاور»).
 * ─────────────────────────────────────────────────────────────────────────
 * یک جفتِ (counselorUserId, studentMemberId) یک «رشته»ی گفتگو می‌سازد —
 * هیچ جدولِ جداگانه‌ی «رشته» لازم نیست، شبیهِ همین الگو در پیام‌رسانیِ ساده.
 * دسترسی: فقط همان مشاور یا همان دانش‌آموز (نه مدیر — این یک گفتگوی
 * مشاوره‌ایست، پیشفرض محرمانه؛ اگر فازِ بعد نیاز به نظارتِ مدیر داشت، همین‌جا
 * جایِ درستِ اضافه‌کردنِ آن است).
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { schoolsTable } from "./schools";

export const schoolCounselorMessagesTable = pgTable("school_counselor_messages", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schoolsTable.id),
  counselorUserId: text("counselor_user_id").notNull(),
  /** ارجاع به `school_members.id` دانش‌آموز */
  studentMemberId: text("student_member_id").notNull(),
  /** فرستنده — یا همان `counselorUserId` یا `users.id` دانش‌آموز */
  senderUserId: text("sender_user_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSchoolCounselorMessageSchema = createInsertSchema(schoolCounselorMessagesTable).omit({ createdAt: true });
export type SchoolCounselorMessage = typeof schoolCounselorMessagesTable.$inferSelect;
export type InsertSchoolCounselorMessage = z.infer<typeof insertSchoolCounselorMessageSchema>;
