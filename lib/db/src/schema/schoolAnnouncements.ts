/**
 * schema/schoolAnnouncements.ts — بخش "/schools" فاز ۲: «پیام همگانی» و
 * «اعلامیه‌ی تعطیلی»، بعلاوه‌ی اعلامیه‌ی مخصوصِ یک کلاس (برایِ معلم).
 * ─────────────────────────────────────────────────────────────────────────
 * جدولِ `notifications` موجود (site-wide) برایِ این منظور مناسب نیست: آن
 * جدول برایِ اعلان‌های سراسریِ سایت (تریال/آپدیت) است و به `schoolId`/
 * `classId` ربطی ندارد. یک جدولِ حداقلیِ جدا ساده‌تر و تمیزتر است.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { schoolsTable } from "./schools";

/** kind های ممکن: "broadcast" | "closure" | "class" */
export const SCHOOL_ANNOUNCEMENT_KINDS = ["broadcast", "closure", "class"] as const;
export type SchoolAnnouncementKind = (typeof SCHOOL_ANNOUNCEMENT_KINDS)[number];

export const schoolAnnouncementsTable = pgTable("school_announcements", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schoolsTable.id),
  /** فقط برای kind="class" پر می‌شود — اعلامیه‌ی معلم به یک کلاسِ خاص */
  classId: text("class_id"),
  authorUserId: text("author_user_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSchoolAnnouncementSchema = createInsertSchema(schoolAnnouncementsTable).omit({ createdAt: true });
export type SchoolAnnouncement = typeof schoolAnnouncementsTable.$inferSelect;
export type InsertSchoolAnnouncement = z.infer<typeof insertSchoolAnnouncementSchema>;
