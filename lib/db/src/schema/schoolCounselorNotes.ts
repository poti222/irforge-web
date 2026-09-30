/**
 * schema/schoolCounselorNotes.ts — بخش "/schools" فاز ۲: یادداشتِ محرمانه‌ی
 * مشاور رویِ یک دانش‌آموز. فقط مشاور/مدیرِ همان مدرسه می‌بینند (اعمال‌شده در
 * routes/schoolCounselor.ts) — دانش‌آموز/والد/معلم هرگز.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const schoolCounselorNotesTable = pgTable("school_counselor_notes", {
  id: text("id").primaryKey(),
  counselorUserId: text("counselor_user_id").notNull(),
  /** ارجاع به `school_members.id` دانش‌آموز */
  studentMemberId: text("student_member_id").notNull(),
  note: text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSchoolCounselorNoteSchema = createInsertSchema(schoolCounselorNotesTable).omit({ createdAt: true });
export type SchoolCounselorNote = typeof schoolCounselorNotesTable.$inferSelect;
export type InsertSchoolCounselorNote = z.infer<typeof insertSchoolCounselorNoteSchema>;
