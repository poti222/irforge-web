/**
 * schema/schoolContentLessons.ts — لایه‌یِ «درس» رویِ کتابخانه‌ی محتوا
 * (school_content_items)، طبقِ گزارشِ مستقیمِ کاربر: «باید بشه یه درس بسازی
 * و توش شعر یا لغت اضافه کنی» — یعنی همان ساختارِ Year→Subject→Section/Lesson
 * که ریپویِ dars رویِ Google Sheets داشت (کتابخانه‌ی فعلی تا این‌جا فقط یک
 * لیستِ فلَتِ هر type بود، بدونِ هیچ گروه‌بندی).
 *
 * ── چرا این جدول ستونِ `type` ندارد؟ ────────────────────────────────────
 * خودِ گزارشِ کاربر («شعر *یا* لغت» در یک درس) یعنی یک درس باید بتواند هم
 * واژه (type=dictionary) و هم شعر (type=poem) و … را هم‌زمان در خودش نگه
 * دارد — پس «درس» باید مستقلِ از نوعِ محتوایِ درونش باشد. اگر این جدول هم
 * یک `type` می‌داشت، برایِ «درسِ ۱» باید دو ردیفِ جدا (یکی برایِ لغت‌نامه،
 * یکی برایِ شعر) می‌ساختیم که دقیقاً برخلافِ خواسته‌ی کاربر است. به‌جایش
 * `school_content_items.lessonId` به هر دری اشاره می‌کند و صفحه‌ی درس همه‌ی
 * آیتم‌های داخلش را با برچسبِ typeِ خودشان گروه‌بندی/نمایش می‌دهد.
 *
 * `subject` اما لازم است: دقیقاً همان گیتِ موضوعیِ معلم↔درسِ تدریسی
 * (school_teacher_subjects) که روی آیتم‌ها اعمال می‌شود، باید روی خودِ
 * «درس» هم اعمال شود — وگرنه معلمِ هندسه می‌توانست یک «درسِ ادبیات» بسازد و
 * محتوایِ ادبیات را داخلش بریزد، بدونِ این‌که بک‌اند بفهمد چون خودِ ایجادِ
 * درس گیت نمی‌شد. برخلافِ `school_content_items.schoolId` (که عمداً nullable
 * است تا محتوایِ سراسریِ پلتفرم را هم بپوشاند)، این‌جا `schoolId` را
 * NOT NULL گذاشتیم: «درس» یک مفهومِ محلیِ یک مدرسه‌ی خاص است (معلمِ همان
 * مدرسه آن را می‌سازد)، برخلافِ لغت‌نامه‌ی عمومیِ احتمالیِ سراسرِ پلتفرم.
 */
import { pgTable, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const schoolContentLessonsTable = pgTable("school_content_lessons", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull(),
  /** یکی از SCHOOL_SUBJECTS (schema/schoolContent.ts) — همان گیتِ موضوعیِ معلم↔درس */
  subject: text("subject").notNull(),
  title: text("title").notNull(),
  /**
   * ترتیبِ نمایشِ درس‌ها داخلِ یک موضوع (کوچک‌تر = بالاتر). تساوی (مثلاً همه ۰ برایِ
   * درس‌هایِ قدیمی) با createdAt شکسته می‌شود، پس backfill لازم نیست.
   */
  sortOrder: integer("sort_order").notNull().default(0),
  /**
   * override انواعِ فعالِ این جلسه — NULL یعنی از موضوع (school_subjects.enabledTypes)
   * ارث می‌برد. مجموعه‌ی مؤثر = enabledTypes ?? subject.enabledTypes.
   */
  enabledTypes: jsonb("enabled_types").$type<string[] | null>(),
  createdByUserId: text("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSchoolContentLessonSchema = createInsertSchema(schoolContentLessonsTable).omit({ createdAt: true, updatedAt: true });
export type SchoolContentLesson = typeof schoolContentLessonsTable.$inferSelect;
export type InsertSchoolContentLesson = z.infer<typeof insertSchoolContentLessonSchema>;
