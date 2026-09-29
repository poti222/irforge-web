/**
 * schema/schoolAssignments.ts — بخش "/schools" فاز ۳ (بندِ ۳): تکالیفِ معلم
 * برایِ یک کلاس + ارسالِ دانش‌آموز.
 * ─────────────────────────────────────────────────────────────────────────
 * ساده‌ترینِ ممکن، دقیقاً مثلِ الگویِ `schoolAnnouncementsTable`: هیچ فایل/
 * پیوستی (این ریپو زیرساختِ آپلود ندارد، ببینید schoolContent.ts)، فقط متن.
 * هر دانش‌آموز حداکثر یک ارسال به‌ازایِ هر تکلیف دارد (ایندکسِ یکتا در
 * مایگریشن) — ارسالِ دوباره یعنی ویرایشِ همان ردیف، نه ردیفِ تازه.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { schoolClassesTable } from "./schoolClasses";

export const schoolAssignmentsTable = pgTable("school_assignments", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => schoolClassesTable.id),
  teacherUserId: text("teacher_user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schoolAssignmentSubmissionsTable = pgTable("school_assignment_submissions", {
  id: text("id").primaryKey(),
  assignmentId: text("assignment_id").notNull().references(() => schoolAssignmentsTable.id),
  /** ارجاع به `school_members.id` دانش‌آموز */
  studentMemberId: text("student_member_id").notNull(),
  content: text("content").notNull().default(""),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  /** نمره — متنِ آزاد (مثلاً "18.5" یا "قبول")، ساختارِ عددیِ دقیق‌تر فازِ بعد */
  grade: text("grade"),
  feedback: text("feedback"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSchoolAssignmentSchema = createInsertSchema(schoolAssignmentsTable).omit({ createdAt: true });
export const insertSchoolAssignmentSubmissionSchema = createInsertSchema(schoolAssignmentSubmissionsTable).omit({ createdAt: true });
export type SchoolAssignment = typeof schoolAssignmentsTable.$inferSelect;
export type SchoolAssignmentSubmission = typeof schoolAssignmentSubmissionsTable.$inferSelect;
export type InsertSchoolAssignment = z.infer<typeof insertSchoolAssignmentSchema>;
export type InsertSchoolAssignmentSubmission = z.infer<typeof insertSchoolAssignmentSubmissionSchema>;
