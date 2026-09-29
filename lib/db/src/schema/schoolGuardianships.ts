/**
 * schema/schoolGuardianships.ts — بخش "/schools" فاز ۲: پیوندِ والد↔دانش‌آموز.
 * فقط مدیر می‌تواند این پیوند را بسازد (از داخلِ صفحه‌ی مدیریتِ اعضا)؛ والد
 * از رویِ این ردیف‌ها می‌بیند فرزندانش چه کسانی‌اند.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const schoolGuardianshipsTable = pgTable("school_guardianships", {
  id: text("id").primaryKey(),
  parentUserId: text("parent_user_id").notNull(),
  /** ارجاع به `school_members.id` دانش‌آموز */
  studentMemberId: text("student_member_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSchoolGuardianshipSchema = createInsertSchema(schoolGuardianshipsTable).omit({ createdAt: true });
export type SchoolGuardianship = typeof schoolGuardianshipsTable.$inferSelect;
export type InsertSchoolGuardianship = z.infer<typeof insertSchoolGuardianshipSchema>;
