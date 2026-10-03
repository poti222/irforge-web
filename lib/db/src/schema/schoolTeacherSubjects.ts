/**
 * schema/schoolTeacherSubjects.ts — تخصیصِ معلم↔درس (کنترلِ دسترسیِ موضوعی).
 * ─────────────────────────────────────────────────────────────────────────
 * قبل از این، هر admin/teacherِ یک مدرسه می‌توانست هر آیتمِ محتواییِ آن مدرسه
 * را بسازد/ویرایش/حذف کند — یعنی یک معلمِ هندسه می‌توانست لغت‌نامه‌ی ادبیات را
 * هم ویرایش کند. این جدول عمداً ساده است، نه یک سیستمِ برنامه‌ریزیِ کلاسی
 * کامل: فقط «معلمِ X درسِ Y را تدریس می‌کند [فقط در کلاسِ Z | در همه‌ی
 * کلاس‌هایش]».
 *
 * `classId` نال یعنی تخصیصِ درس در سطحِ کل مدرسه (همه‌ی کلاس‌هایِ آن معلم).
 * چون کتابخانه‌ی محتوا (`school_content_items`) اصلاً به کلاسِ خاصی وصل
 * نیست، برایِ enforcement در routes/schoolContent.ts همین کافی‌ست که معلم
 * *یک* ردیف با همین `subject` (با هر classId، حتی یک کلاسِ خاص) در این
 * مدرسه داشته باشد — تطبیقِ دقیقِ کلاس لازم نیست.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { schoolsTable } from "./schools";
import { schoolClassesTable } from "./schoolClasses";

export const schoolTeacherSubjectsTable = pgTable("school_teacher_subjects", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schoolsTable.id),
  teacherUserId: text("teacher_user_id").notNull(),
  /** یکی از SCHOOL_SUBJECTS (schema/schoolContent.ts) — متنِ آزاد، همان دلیلِ آن ستون */
  subject: text("subject").notNull(),
  /** null = این درس را در همه‌یِ کلاس‌هایِ خودش تدریس می‌کند (برایِ کتابخانه‌ی محتوا کافی‌ست) */
  classId: text("class_id").references(() => schoolClassesTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSchoolTeacherSubjectSchema = createInsertSchema(schoolTeacherSubjectsTable).omit({ createdAt: true });
export type SchoolTeacherSubject = typeof schoolTeacherSubjectsTable.$inferSelect;
export type InsertSchoolTeacherSubject = z.infer<typeof insertSchoolTeacherSubjectSchema>;
