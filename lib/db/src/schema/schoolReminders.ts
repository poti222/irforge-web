/**
 * schema/schoolReminders.ts — «یادآورهایِ دانش‌آموزی»: پیامِ تکرارشونده با روزهایِ هفتهٔ دلخواه و چند ساعت در روز.
 * ─────────────────────────────────────────────────────────────────────────
 *  • school_reminders       — خودِ یادآور (متن + weekdays + times + بازهٔ تاریخ + روزهایِ استثنا). class_id=NULL ⇒ کلِ مدرسه (فقط مدیر).
 *  • school_reminder_groups — گروه‌هایِ تلگرامیِ باتِ مدرسه که علاوه بر پیوی‌ها پیام در آن‌ها هم می‌رود.
 *  • school_reminder_log    — کلیدِ ترکیبیِ (یادآور، روز، ساعت، مقصد) = idempotency؛ ردیف پیش از ارسال ثبت می‌شود (claim).
 * قرارداد: weekdays شنبه=۰ … جمعه=۶؛ times رشتهٔ «HH:MM» به وقتِ تهران. مایگریشن: api-server/migrate.mjs (آینه: 0062).
 */
import { pgTable, text, timestamp, boolean, integer, date, primaryKey, index } from "drizzle-orm/pg-core";
import { schoolsTable } from "./schools";
import { schoolClassesTable } from "./schoolClasses";
import { schoolBotGroupsTable } from "./schoolReps";

export const schoolRemindersTable = pgTable("school_reminders", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schoolsTable.id),
  classId: text("class_id").references(() => schoolClassesTable.id),
  title: text("title").notNull().default(""),
  message: text("message").notNull(),
  weekdays: integer("weekdays").array().notNull(),
  times: text("times").array().notNull(),
  startDate: date("start_date", { mode: "string" }),
  endDate: date("end_date", { mode: "string" }),
  skipDates: date("skip_dates", { mode: "string" }).array().notNull().default([]),
  sendDm: boolean("send_dm").notNull().default(true),
  active: boolean("active").notNull().default(true),
  createdByUserId: text("created_by_user_id").notNull(),
  /** teacher | admin | deputy | deputy_discipline | rep (دانش‌آموزِ منتخب) */
  createdByRole: text("created_by_role").notNull(),
  updatedByUserId: text("updated_by_user_id"),
  lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("school_reminders_school_idx").on(t.schoolId, t.active),
  index("school_reminders_class_idx").on(t.classId),
]);

export const schoolReminderGroupsTable = pgTable("school_reminder_groups", {
  reminderId: text("reminder_id").notNull().references(() => schoolRemindersTable.id, { onDelete: "cascade" }),
  groupId: text("group_id").notNull().references(() => schoolBotGroupsTable.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.reminderId, t.groupId] })]);

export const schoolReminderLogTable = pgTable("school_reminder_log", {
  reminderId: text("reminder_id").notNull().references(() => schoolRemindersTable.id, { onDelete: "cascade" }),
  runDate: date("run_date", { mode: "string" }).notNull(),
  runTime: text("run_time").notNull(),
  /** `dm:<userId>` یا `g:<groupId>` */
  target: text("target").notNull(),
  ok: boolean("ok").notNull().default(true),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.reminderId, t.runDate, t.runTime, t.target] }),
  index("school_reminder_log_date_idx").on(t.runDate),
]);
