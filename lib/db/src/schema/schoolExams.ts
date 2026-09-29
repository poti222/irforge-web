/**
 * schema/schoolExams.ts — بخش "/schools" فاز ۴ (بندِ ۲): آزمونِ معلم (چند
 * سؤال از بانکِ سؤال، برایِ یک کلاس) + تلاشِ دانش‌آموز برایِ گرفتنِ آزمون.
 * ─────────────────────────────────────────────────────────────────────────
 * تصمیم: هر دانش‌آموز فقط یک تلاش به‌ازایِ هر آزمون دارد (ایندکسِ یکتا در
 * مایگریشن، دقیقاً همان الگویِ `school_assignment_submissions`) — بدونِ
 * چندبارتلاش‌مجاز/بدونِ محدودیتِ زمانی سخت‌گیرانه، طبقِ اسکوپِ فازِ ۴.
 * `answers`: نگاشتِ questionId→پاسخِ دانش‌آموز (رشته). `score`: نمره‌ی خودکار
 * (اگر همه‌ی سؤال‌ها چندگزینه‌ای با correctAnswer باشند) یا نمره‌ای که معلم
 * دستی ثبت می‌کند (اگر سؤالِ تشریحی داشته باشد) — دقیقاً مثلِ `grade` در
 * schoolAssignments.
 */
import { pgTable, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { schoolClassesTable } from "./schoolClasses";

export const schoolExamsTable = pgTable("school_exams", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => schoolClassesTable.id),
  teacherUserId: text("teacher_user_id").notNull(),
  title: text("title").notNull(),
  questionIds: jsonb("question_ids").$type<string[]>().notNull().default([]),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  durationMinutes: integer("duration_minutes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schoolExamAttemptsTable = pgTable("school_exam_attempts", {
  id: text("id").primaryKey(),
  examId: text("exam_id").notNull().references(() => schoolExamsTable.id),
  /** ارجاع به `school_members.id` دانش‌آموز */
  studentMemberId: text("student_member_id").notNull(),
  answers: jsonb("answers").$type<Record<string, string>>().notNull().default({}),
  score: text("score"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
});

export const insertSchoolExamSchema = createInsertSchema(schoolExamsTable).omit({ createdAt: true });
export const insertSchoolExamAttemptSchema = createInsertSchema(schoolExamAttemptsTable).omit({ startedAt: true });

export type SchoolExam = typeof schoolExamsTable.$inferSelect;
export type SchoolExamAttempt = typeof schoolExamAttemptsTable.$inferSelect;
export type InsertSchoolExam = z.infer<typeof insertSchoolExamSchema>;
export type InsertSchoolExamAttempt = z.infer<typeof insertSchoolExamAttemptSchema>;
