/**
 * schema/schoolReps.ts — «دانش‌آموزِ منتخب» (مسئولِ کلاس) + گروه‌هایِ تلگرامیِ باتِ مدرسه + تکلیف/امتحان/یادآوریِ ثبت‌شده توسطِ منتخب.
 * ─────────────────────────────────────────────────────────────────────────
 *  • school_class_reps      — معلم برایِ هر کلاسش یک یا چند دانش‌آموزِ منتخب انتخاب می‌کند (به‌ازایِ هر معلم یکتا).
 *  • school_bot_groups      — گروه‌هایی که باتِ مدرسه در آن‌ها عضو/ادمین است. تلگرام API برایِ «فهرستِ گروه‌هایِ بات» ندارد؛
 *                             فقط آپدیتِ `my_chat_member` می‌رسد (وقتی بات اضافه/حذف می‌شود) یا کاربر در گروه `/bind` می‌زند.
 *  • school_rep_items       — تکلیف/امتحان/یادآوریِ ثبت‌شده توسطِ منتخب، با موعد و «چند روز قبل یادآوری کن».
 *  • school_rep_item_groups — گروه‌هایی که یادآوری باید در آن‌ها برود.
 *  • school_rep_reminder_log— هر (مورد، گروه، روزِ قبل) حداکثر یک‌بار ارسال می‌شود (کلیدِ اصلیِ ترکیبی = idempotency).
 *  • school_rep_dm_log      — همان برایِ مواردِ بدونِ گروه که یادآوری به پیویِ خودِ منتخب می‌رود.
 * مایگریشنِ زمان‌اجرا: api-server/migrate.mjs (این فایل آینهٔ آن است؛ مایگریشنِ ۰۰۵۸ هم همین را تکرار می‌کند).
 */
import { pgTable, text, timestamp, boolean, integer, date, primaryKey, uniqueIndex, index } from "drizzle-orm/pg-core";
import { schoolsTable } from "./schools";
import { schoolClassesTable } from "./schoolClasses";
import { schoolBotsTable } from "./schoolBots";

export const schoolClassRepsTable = pgTable("school_class_reps", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schoolsTable.id),
  classId: text("class_id").notNull().references(() => schoolClassesTable.id),
  /** ارجاع به `school_members.id` (دانش‌آموز) — مثلِ school_class_members. */
  studentMemberId: text("student_member_id").notNull(),
  /** معلمی که انتخاب کرده (`users.id`). */
  teacherUserId: text("teacher_user_id").notNull(),
  /** آخرین روزی (YYYY-MM-DD تهران) که بات از این دانش‌آموز پرسید «تکلیف/امتحان داری؟» — برایِ حداکثر یک پرسش در روز. */
  lastPromptOn: date("last_prompt_on", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("school_class_reps_uk").on(t.classId, t.studentMemberId, t.teacherUserId),
  index("school_class_reps_student_idx").on(t.studentMemberId),
  index("school_class_reps_school_idx").on(t.schoolId),
]);

export const schoolBotGroupsTable = pgTable("school_bot_groups", {
  id: text("id").primaryKey(),
  schoolBotId: text("school_bot_id").notNull().references(() => schoolBotsTable.id),
  telegramChatId: text("telegram_chat_id").notNull(),
  title: text("title").notNull().default(""),
  /** group | supergroup | channel */
  chatType: text("chat_type").notNull().default("group"),
  /** وضعیتِ خودِ بات: administrator | member | restricted | left | kicked */
  botStatus: text("bot_status").notNull().default("member"),
  /** آیا بات می‌تواند پیام بفرستد (ادمین/عضوِ آزاد)؟ */
  canPost: boolean("can_post").notNull().default(true),
  /** چطور ثبت شد: my_chat_member | bind */
  source: text("source").notNull().default("my_chat_member"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("school_bot_groups_uk").on(t.schoolBotId, t.telegramChatId),
]);

export const schoolRepItemsTable = pgTable("school_rep_items", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schoolsTable.id),
  classId: text("class_id").notNull().references(() => schoolClassesTable.id),
  createdByMemberId: text("created_by_member_id").notNull(),
  createdByUserId: text("created_by_user_id").notNull(),
  /** assignment | exam | reminder */
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  /** موعد: YYYY-MM-DD (به وقتِ تهران). */
  dueDate: date("due_date", { mode: "string" }).notNull(),
  /** «چند روز قبل از موعد یادآوری برو» — مثلاً {3,1}؛ ۰ = همان روز. */
  remindDays: integer("remind_days").array().notNull(),
  /** active | cancelled | done */
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("school_rep_items_class_idx").on(t.classId, t.status, t.dueDate),
  index("school_rep_items_school_idx").on(t.schoolId, t.status),
]);

export const schoolRepItemGroupsTable = pgTable("school_rep_item_groups", {
  itemId: text("item_id").notNull().references(() => schoolRepItemsTable.id, { onDelete: "cascade" }),
  groupId: text("group_id").notNull().references(() => schoolBotGroupsTable.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.itemId, t.groupId] })]);

export const schoolRepReminderLogTable = pgTable("school_rep_reminder_log", {
  itemId: text("item_id").notNull().references(() => schoolRepItemsTable.id, { onDelete: "cascade" }),
  groupId: text("group_id").notNull().references(() => schoolBotGroupsTable.id, { onDelete: "cascade" }),
  daysBefore: integer("days_before").notNull(),
  ok: boolean("ok").notNull().default(true),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.itemId, t.groupId, t.daysBefore] })]);

export const schoolRepDmLogTable = pgTable("school_rep_dm_log", {
  itemId: text("item_id").notNull().references(() => schoolRepItemsTable.id, { onDelete: "cascade" }),
  daysBefore: integer("days_before").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.itemId, t.daysBefore] })]);

export type SchoolClassRep = typeof schoolClassRepsTable.$inferSelect;
export type SchoolBotGroup = typeof schoolBotGroupsTable.$inferSelect;
export type SchoolRepItem = typeof schoolRepItemsTable.$inferSelect;
