/**
 * schema/schoolClasses.ts — بخش "/schools" فاز ۲: مدیریتِ کلاس‌ها.
 * ─────────────────────────────────────────────────────────────────────────
 * دو جدولِ ساده: خودِ کلاس (نام/پایه/سالِ تحصیلی) و اعضایِ آن (دانش‌آموز یا
 * معلم). عمداً بدونِ مدل‌سازیِ درس/زنگ/تقویمِ کامل — فقط همان چیزی که برای
 * «چه کسی توی چه کلاسیه» و شمارشِ ساده‌ی کارتِ «وضعیتِ درسی» لازم است.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { schoolsTable } from "./schools";

export const schoolClassesTable = pgTable("school_classes", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schoolsTable.id),
  name: text("name").notNull(),
  grade: text("grade"),
  academicYear: text("academic_year"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** roleInClass های ممکن: "student" | "teacher" (معلمِ اصلی/مسئولِ کلاس) */
export const schoolClassMembersTable = pgTable("school_class_members", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => schoolClassesTable.id),
  /** ارجاع به `school_members.id`، نه به `users.id` — چون عضویتِ کلاسی معنادار است فقط در قالبِ همان عضویتِ مدرسه‌ای. */
  schoolMemberId: text("school_member_id").notNull(),
  roleInClass: text("role_in_class").notNull().default("student"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSchoolClassSchema = createInsertSchema(schoolClassesTable).omit({ createdAt: true });
export const insertSchoolClassMemberSchema = createInsertSchema(schoolClassMembersTable).omit({ addedAt: true });

export type SchoolClass = typeof schoolClassesTable.$inferSelect;
export type SchoolClassMember = typeof schoolClassMembersTable.$inferSelect;
export type InsertSchoolClass = z.infer<typeof insertSchoolClassSchema>;
export type InsertSchoolClassMember = z.infer<typeof insertSchoolClassMemberSchema>;
