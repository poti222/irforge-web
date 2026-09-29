/**
 * schema/schoolAttendance.ts — بخش "/schools" فاز ۶ (بندِ ۱): حضور و غیاب.
 * ─────────────────────────────────────────────────────────────────────────
 * یک ردیف به‌ازایِ هر (کلاس، دانش‌آموز، روز) — `date` عمداً تاریخِ ساده است
 * نه timestamp، چون «حضورِ فلان‌روز» معنایی زمان‌دار ندارد و مقایسه/فیلترِ
 * بازه‌ی تاریخی را ساده‌تر می‌کند. ایندکسِ یکتایِ (classId, studentMemberId,
 * date) دقیقاً همان الگویِ «یک ارسال به‌ازایِ هر دانش‌آموز»یِ
 * schoolAssignmentSubmissions/schoolExamAttempts است: نشانه‌گذاریِ دوباره
 * یعنی ویرایشِ همان ردیف (upsert)، نه ردیفِ تازه.
 */
import { pgTable, text, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { schoolClassesTable } from "./schoolClasses";

/** status های ممکن: "present" | "absent" | "late" | "excused" */
export const schoolAttendanceTable = pgTable("school_attendance", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => schoolClassesTable.id),
  /** ارجاع به `school_members.id` دانش‌آموز */
  studentMemberId: text("student_member_id").notNull(),
  date: date("date").notNull(),
  status: text("status").notNull().default("present"),
  /** کاربرِ ثبت‌کننده — معلم/مدیر/معاون/معاونِ‌انضباطی */
  markedByUserId: text("marked_by_user_id").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSchoolAttendanceSchema = createInsertSchema(schoolAttendanceTable).omit({ createdAt: true });
export type SchoolAttendance = typeof schoolAttendanceTable.$inferSelect;
export type InsertSchoolAttendance = z.infer<typeof insertSchoolAttendanceSchema>;
