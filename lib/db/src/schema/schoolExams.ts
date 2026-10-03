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
import { pgTable, text, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";
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
  /**
   * فازِ ۱۰ (بندِ ۲.۲): اگر true باشد، هر دانش‌آموز ترتیبِ به‌هم‌ریخته‌ی خودش را
   * می‌بیند (یک‌بار در attempts/start ساخته و در questionOrder همان تلاش
   * ذخیره می‌شود) — نمایِ خودِ معلم همیشه ترتیبِ بانکِ سؤال (questionIds) است.
   */
  randomizeOrder: boolean("randomize_order").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** ببینید schoolExams.ts (بالا) — یک ردیف به‌ازایِ هر سؤال در answerBreakdown. */
export interface ExamAnswerBreakdownEntry {
  questionId: string;
  /** null = سؤالِ تشریحی که هنوز معلم نمره‌اش را نداده. */
  correct: boolean | null;
  /** null = هنوز نمره‌دهی نشده. */
  pointsAwarded: number | null;
}

export const schoolExamAttemptsTable = pgTable("school_exam_attempts", {
  id: text("id").primaryKey(),
  examId: text("exam_id").notNull().references(() => schoolExamsTable.id),
  /** ارجاع به `school_members.id` دانش‌آموز */
  studentMemberId: text("student_member_id").notNull(),
  answers: jsonb("answers").$type<Record<string, string>>().notNull().default({}),
  /**
   * فازِ ۱۰ (بندِ ۲.۱): نمره‌ی تجمیعیِ همیشه از answerBreakdown محاسبه می‌شود
   * (نه یک محاسبه‌یِ موازیِ دیگر) — نگه داشته شده فقط برایِ سازگاریِ
   * پس‌رو (مثلاً routes/schoolGradebook.ts که فقط این رشته‌ی "x/y" را
   * می‌خواند).
   */
  score: text("score"),
  /**
   * فازِ ۱۰ (بندِ ۲.۱): شکستِ نمره به‌ازایِ هر سؤال — در submit برایِ سؤال‌هایِ
   * چندگزینه‌ایِ خودکار-نمره‌پذیر پر می‌شود؛ برایِ تشریحی تا نمره‌دهیِ معلم
   * (PATCH .../attempts/:id) با correct/pointsAwarded=null می‌ماند.
   */
  answerBreakdown: jsonb("answer_breakdown").$type<ExamAnswerBreakdownEntry[] | null>(),
  /**
   * فازِ ۱۰ (بندِ ۲.۲): ترتیبِ سؤال‌ها برایِ همینِ دانش‌آموز، وقتی exam.randomizeOrder
   * باشد — فقط یک‌بار در attempts/start تصادفی ساخته می‌شود تا بازدیدِ دوباره‌ی
   * همان تلاش ترتیبِ ثابتی ببیند، نه قاطی‌شده‌یِ تازه.
   */
  questionOrder: jsonb("question_order").$type<string[] | null>(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  /**
   * فازِ ۶ (بندِ ۳): آیا ارسال بعد از پایانِ durationMinutes بوده؟ ارسالِ دیرهنگام
   * هرگز رد نمی‌شود (کارِ دانش‌آموز هیچ‌وقت بی‌صدا دور ریخته نمی‌شود) — فقط
   * برایِ دیدِ معلم علامت می‌خورد. ببینید محاسبه‌ی سمتِ سرور در
   * routes/schoolExams.ts (attempts/submit).
   */
  lateSubmission: boolean("late_submission").notNull().default(false),
});

export const insertSchoolExamSchema = createInsertSchema(schoolExamsTable).omit({ createdAt: true });
export const insertSchoolExamAttemptSchema = createInsertSchema(schoolExamAttemptsTable).omit({ startedAt: true });

export type SchoolExam = typeof schoolExamsTable.$inferSelect;
export type SchoolExamAttempt = typeof schoolExamAttemptsTable.$inferSelect;
export type InsertSchoolExam = z.infer<typeof insertSchoolExamSchema>;
export type InsertSchoolExamAttempt = z.infer<typeof insertSchoolExamAttemptSchema>;
