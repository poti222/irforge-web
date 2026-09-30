/**
 * schema/schoolStudentAlerts.ts — بخش "/schools" فاز ۶ (بندِ ۴): اخطار/هشدارِ
 * انضباطی برایِ دانش‌آموز.
 * ─────────────────────────────────────────────────────────────────────────
 * مفهومِ کاملاً تازه‌ای که تا این فاز وجود نداشت — درخواستِ صریحِ کاربر:
 * «اخطار/هشدارِ فرزند». صادرکننده: admin/deputy/deputy_discipline (چکِ
 * دسترسی در روت با canAccessSchool). این جدول اولین جایی‌ست که
 * deputy_discipline («معاونِ انضباطی») یک قابلیتِ واقعاً مجزا از deputy
 * ساده دارد — تا فازِ ۵ این دو نقش همیشه لیستِ یکسانی از مجوزها داشتند.
 * severity متنِ آزاد است نه enum پایگاه‌داده (همان الگویِ role/status در بقیه‌ی
 * جداولِ این بخش) — مقادیرِ مجاز در لایه‌ی اپلیکیشن: "notice" | "warning" | "serious".
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { schoolsTable } from "./schools";

export const schoolStudentAlertsTable = pgTable("school_student_alerts", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schoolsTable.id),
  /** ارجاع به `school_members.id` دانش‌آموز */
  studentMemberId: text("student_member_id").notNull(),
  issuedByUserId: text("issued_by_user_id").notNull(),
  severity: text("severity").notNull().default("notice"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSchoolStudentAlertSchema = createInsertSchema(schoolStudentAlertsTable).omit({ createdAt: true });
export type SchoolStudentAlert = typeof schoolStudentAlertsTable.$inferSelect;
export type InsertSchoolStudentAlert = z.infer<typeof insertSchoolStudentAlertSchema>;
