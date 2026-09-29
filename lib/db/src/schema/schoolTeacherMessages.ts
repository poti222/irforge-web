/**
 * schema/schoolTeacherMessages.ts — بخش "/schools" فاز ۵ (بندِ ۱): «ارتباط با
 * معلم». برخلافِ ارتباط با مدیر، این واقعاً باید ۱:۱ باشد — دانش‌آموز فقط با
 * معلمی که واقعاً سرِ کلاسِ اوست گفتگو می‌کند (دسترسی در روت با روسترِ
 * school_class_members چک می‌شود، دقیقاً همان الگویِ schoolAssignments.ts).
 * ساختارِ جدول عیناً کپیِ school_counselor_messages است، فقط counselorUserId
 * اینجا teacherUserId شده.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { schoolsTable } from "./schools";

export const schoolTeacherMessagesTable = pgTable("school_teacher_messages", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schoolsTable.id),
  teacherUserId: text("teacher_user_id").notNull(),
  /** ارجاع به `school_members.id` دانش‌آموز */
  studentMemberId: text("student_member_id").notNull(),
  /** فرستنده — یا همان `teacherUserId` یا `users.id` دانش‌آموز */
  senderUserId: text("sender_user_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSchoolTeacherMessageSchema = createInsertSchema(schoolTeacherMessagesTable).omit({ createdAt: true });
export type SchoolTeacherMessage = typeof schoolTeacherMessagesTable.$inferSelect;
export type InsertSchoolTeacherMessage = z.infer<typeof insertSchoolTeacherMessageSchema>;
