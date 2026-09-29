/**
 * schema/schoolPrograms.ts — بخش "/schools" فاز ۲: «مدیریتِ برنامه‌ها».
 * یک ردیفِ سادۀ «برنامه» — یا یک زنگِ هفتگی (روز/ساعتِ شروع-پایان) یا صرفاً
 * یک اعلامیه‌ی برنامه‌ی ترم بدونِ زمان‌بندی. عمداً بدونِ موتورِ کاملِ
 * تایم‌تیبل (تداخلِ زنگ‌ها/درس‌ها و…).
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { schoolsTable } from "./schools";

export const schoolProgramsTable = pgTable("school_programs", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schoolsTable.id),
  /** null = برای کلِ مدرسه، در غیر این صورت مختصِ یک کلاس */
  classId: text("class_id"),
  title: text("title").notNull(),
  description: text("description"),
  /** ۰=شنبه..۶=جمعه — nullable برای برنامه‌های بدونِ روزِ ثابت */
  dayOfWeek: text("day_of_week"),
  startTime: text("start_time"),
  endTime: text("end_time"),
  createdByUserId: text("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSchoolProgramSchema = createInsertSchema(schoolProgramsTable).omit({ createdAt: true });
export type SchoolProgram = typeof schoolProgramsTable.$inferSelect;
export type InsertSchoolProgram = z.infer<typeof insertSchoolProgramSchema>;
