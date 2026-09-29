/**
 * schema/schoolQuestions.ts — بخش "/schools" فاز ۴ (بندِ ۲): بانکِ سؤالِ
 * معلم. سؤال‌ها مستقلِ آزمون ذخیره می‌شوند؛ یک آزمون فقط شناسه‌یِ چند سؤال را
 * نگه می‌دارد (`school_exams.question_ids`) — همان سؤال در چند آزمون قابلِ
 * استفاده‌ی دوباره است.
 * ─────────────────────────────────────────────────────────────────────────
 * `choices`: آرایه‌ای از رشته برای سؤالِ چندگزینه‌ای، یا null برای سؤالِ
 * تشریحی (که همیشه نیاز به نمره‌دهیِ دستی دارد). `correctAnswer`: اندیسِ
 * (به‌صورتِ رشته، مثلاً "0") گزینه‌ی درست وقتی choices پر است؛ برای سؤالِ
 * تشریحی معمولاً null.
 */
import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { schoolsTable } from "./schools";

export const schoolQuestionsTable = pgTable("school_questions", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schoolsTable.id),
  teacherUserId: text("teacher_user_id").notNull(),
  questionText: text("question_text").notNull(),
  choices: jsonb("choices").$type<string[] | null>(),
  correctAnswer: text("correct_answer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSchoolQuestionSchema = createInsertSchema(schoolQuestionsTable).omit({ createdAt: true });
export type SchoolQuestion = typeof schoolQuestionsTable.$inferSelect;
export type InsertSchoolQuestion = z.infer<typeof insertSchoolQuestionSchema>;
