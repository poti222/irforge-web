/**
 * schema/schoolMessageReadState.ts — بخش "/schools" فاز ۹ (بندِ ۱): وضعیتِ
 * خوانده‌شدنِ رشته‌های گفتگو (صندوق‌هایِ مدیر/معلم/مشاور + چتِ والد/دانش‌آموز)
 * که از فازِ ۶ معلق مانده بود.
 * ─────────────────────────────────────────────────────────────────────────
 * به‌جایِ یک ستونِ `read` روی خودِ پیام‌ها (که سه جدولِ جداگانه‌ی پیام —
 * schoolAdminMessages/schoolTeacherMessages/schoolCounselorMessages — را
 * مجبور می‌کرد هرکدام مکانیزمِ خودشان را داشته باشند)، یک جدولِ مشترکِ
 * «آخرین‌بارِ خواندنِ هر (کاربر، رشته)» — دقیقاً همان الگویِ رایجِ inbox/thread
 * read-state (شبیهِ last_read_message_id در چت‌اپ‌ها، اینجا ساده‌تر: فقط
 * timestamp، چون ترتیبِ پیام‌ها با created_at کافی‌ست).
 *
 * `threadKey` رشته‌ای‌ست که هرکدام از سه سیستمِ پیام به شکلِ خودش می‌سازد
 * (ببینید lib/schoolMessageReadState.ts در api-server — همان‌جا سازنده‌های
 * `adminThreadKey`/`teacherThreadKey`/`counselorThreadKey` تعریف شده‌اند):
 *   admin:{schoolId}:{studentMemberId}                      — رشته‌ی مشترک
 *   teacher:{schoolId}:{teacherUserId}:{studentMemberId}     — ۱:۱
 *   counselor:{schoolId}:{counselorUserId}:{studentMemberId} — ۱:۱
 * یکتاییِ ردیف رویِ (userId, threadKey) است (یک کاربر، یک رشته، یک ردیف) —
 * در مایگریشن با ایندکسِ یکتا اعمال می‌شود، همان قراردادِ بقیه‌ی این فایل‌ها.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const schoolMessageReadStateTable = pgTable("school_message_read_state", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  threadKey: text("thread_key").notNull(),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSchoolMessageReadStateSchema = createInsertSchema(schoolMessageReadStateTable);
export type SchoolMessageReadState = typeof schoolMessageReadStateTable.$inferSelect;
export type InsertSchoolMessageReadState = z.infer<typeof insertSchoolMessageReadStateSchema>;
