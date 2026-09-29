/**
 * schema/schoolCounselorReports.ts — بخش "/schools" فاز ۴ (بندِ ۱): گزارشِ
 * مشاور که برخلافِ `school_counselor_notes` (که محرمانه و فقط برایِ خودِ
 * مشاور/دیدنِ داخلی می‌ماند) قرار است مدیر/معاونِ مدرسه هم ببیند — مثلاً
 * گزارشِ دوره‌ایِ وضعیتِ یک دانش‌آموز یا یک گزارشِ کلی/عمومی.
 * ─────────────────────────────────────────────────────────────────────────
 * `studentMemberId` عمداً nullable است: گزارش می‌تواند دربابِ یک دانش‌آموزِ
 * خاص باشد یا یک گزارشِ عمومی/کلی (مثلاً «خلاصه‌ی وضعیتِ روانی-اجتماعیِ این
 * ترم»).
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { schoolsTable } from "./schools";

export const schoolCounselorReportsTable = pgTable("school_counselor_reports", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schoolsTable.id),
  counselorUserId: text("counselor_user_id").notNull(),
  /** ارجاع به `school_members.id` دانش‌آموز — null یعنی گزارشِ عمومی */
  studentMemberId: text("student_member_id"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSchoolCounselorReportSchema = createInsertSchema(schoolCounselorReportsTable).omit({ createdAt: true });
export type SchoolCounselorReport = typeof schoolCounselorReportsTable.$inferSelect;
export type InsertSchoolCounselorReport = z.infer<typeof insertSchoolCounselorReportSchema>;
