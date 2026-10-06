/**
 * schema/schoolTimetable.ts — «برنامه‌ی هفتگیِ» واقعیِ هر کلاس: هر ردیف یک زنگ (روز + ساعتِ شروع/پایان + درس).
 * ─────────────────────────────────────────────────────────────────────────
 * جدولِ قدیمیِ `school_programs` (عنوان/روزِ اختیاری) دست‌نخورده می‌ماند چون برنامه‌یِ مشاور و اعلان‌ها از آن می‌خوانند؛
 * این جدول جایِ آن برایِ «زنگ‌ها» نیست بلکه مدلِ درستِ تایم‌تیبل است.
 * `dayOfWeek`: ۰=شنبه … ۶=جمعه (هفته‌یِ ایرانی). ساعت‌ها TEXT با قالبِ ثابتِ "HH:MM" هستند تا مقایسه‌یِ رشته‌ای
 * با مقایسه‌یِ زمانی یکی باشد. `subject` متنِ آزاد است (نامِ درسِ واقعی یا «تفریح»/«نماز»)، همان قراردادِ بقیه‌یِ جدول‌هایِ درس.
 */
import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";

export const schoolTimetableSlotsTable = pgTable("school_timetable_slots", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull(),
  classId: text("class_id").notNull(),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  subject: text("subject").notNull(),
  teacherUserId: text("teacher_user_id"),
  note: text("note"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type SchoolTimetableSlot = typeof schoolTimetableSlotsTable.$inferSelect;
