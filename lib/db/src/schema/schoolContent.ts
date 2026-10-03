/**
 * schema/schoolContent.ts — محتوایِ آموزشیِ بخش «/schools» (لغت‌نامه/جزوه/کتاب/فرمول).
 * ─────────────────────────────────────────────────────────────────────────
 * برخلافِ ریپوی dars (که این داده روی Google Sheets و به‌صورتِ فلش‌کارتِ
 * ساده بود)، اینجا یک جدولِ واقعیِ Postgres با CRUD است — طبق دستورِ کاربر:
 * فقط *ساختار* از dars گرفته شود، نه دیتا/کدِ Sheets.
 *
 * `schoolId` عمداً nullable است: محتوا می‌تواند سطحِ کل پلتفرم باشد (مثلاً
 * یک لغت‌نامه‌ی عمومیِ فارسی-انگلیسی که همه‌ی مدرسه‌ها می‌بینند) یا مختصِ یک
 * مدرسه (مثلاً جزوه‌ی معلمِ همان مدرسه). null یعنی «عمومی/همه‌ی مدرسه‌ها».
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * type های ممکن: "dictionary" | "note" | "book" | "formula" | "poem".
 * "poem" اضافه شد طبقِ گزارشِ مستقیمِ کاربر («شعر یا لغت») — از نظرِ شکلِ
 * داده دقیقاً مثلِ بقیه (title/body/language/subject/imageUrl)، یک شعر فقط
 * متنِ body است، چیزِ خاصِ دیگری لازم ندارد.
 */
export const SCHOOL_CONTENT_TYPES = ["dictionary", "note", "book", "formula", "poem"] as const;
export type SchoolContentType = (typeof SCHOOL_CONTENT_TYPES)[number];

/**
 * درس‌هایِ معمولِ دبیرستانِ ایران — فهرستِ ثابت برایِ پیکرِ انتخابِ UI (و تخصیصِ
 * معلم↔درس در schoolTeacherSubjects.ts). روی خودِ ستون به‌عمد enum/FK دیتابیسی
 * نیست (متنِ آزاد) تا اضافه‌کردنِ یک درسِ جدید بدونِ مایگریشن ممکن باشد؛
 * محدودسازی به همین فهرست فقط در لایه‌ی UI/اعتبارسنجیِ اپلیکیشن است.
 * فارسی/عربی/انگلیسی (لغت‌نامه) و فیزیک (فرمول) از CONFIG قدیمیِ ریپویِ dars
 * گرفته شده‌اند؛ بقیه دروسِ معمولِ دبیرستانِ ایران + یک سطلِ عمومیِ "سایر".
 */
export const SCHOOL_SUBJECTS = [
  "ریاضی",
  "فیزیک",
  "شیمی",
  "زیست‌شناسی",
  "ادبیاتِ فارسی",
  "عربی",
  "زبانِ انگلیسی",
  "دینی",
  "تاریخ",
  "جغرافیا",
  "ورزش",
  "سایر",
] as const;
export type SchoolSubject = (typeof SCHOOL_SUBJECTS)[number];

export const schoolContentItemsTable = pgTable("school_content_items", {
  id: text("id").primaryKey(),
  /** null = محتوایِ عمومیِ پلتفرم، در غیر این صورت مختصِ همان مدرسه */
  schoolId: text("school_id"),
  /** type های ممکن: "dictionary" | "note" | "book" | "formula" */
  type: text("type").notNull(),
  title: text("title").notNull(),
  /**
   * می‌تواند markdown/متنِ حاویِ LaTeX باشد — برایِ type="formula" با KaTeX
   * روی فرانت رندر می‌شود (ببینید irforge/src/components/schools/FormulaBody.tsx).
   */
  body: text("body").notNull().default(""),
  /** فقط برای لغت‌نامه معنا دارد — "fa" | "en" | ... */
  language: text("language"),
  /**
   * بخشِ کنترلِ دسترسیِ معلم↔درس: معلم فقط می‌تواند آیتمِ محتوایی بسازد/ویرایش
   * کند که `subject`اش یکی از درسهایِ تخصیص‌داده‌شده به او باشد (ببینید
   * `canWrite()` در routes/schoolContent.ts). nullable چون بعضی محتوا واقعاً
   * بدونِ‌درس است (مثلاً یک یادداشتِ عمومیِ شبه‌اطلاعیه)؛ آیتم‌هایِ از قبل
   * موجود (قبل از این ستون) هم `NULL` می‌مانند — فقط مدیر می‌تواند آن‌ها را
   * (تا زمانِ برچسب‌گذاریِ دوباره با یک درسِ واقعی) ویرایش کند، نه هر معلمی
   * بدونِ مالکیتِ مشخص و نه این‌که برایِ نویسنده‌ی اصلی‌اش قفل شود.
   */
  subject: text("subject"),
  /**
   * فاز ۳ — این ریپو هیچ زیرساختِ آپلودِ فایلِ عمومی ندارد (نه S3، نه چیزِ
   * مشابه؛ `uploadSessions` یک رله‌یِ چتِ باتِ تلگرام است، نه آپلودِ فایل).
   * به‌جایِ ساختنِ زیرساختِ ابری که خارج از محدوده‌ی این فاز است، فقط یک
   * فیلدِ URLِ ساده (مدیر/معلم لینکِ یک عکسِ از‌قبل‌میزبانی‌شده را می‌دهد) —
   * در فازِ بعد اگر اولویت شد، همین ستون می‌تواند با آپلودِ واقعی جایگزین شود.
   */
  imageUrl: text("image_url"),
  /**
   * لایه‌یِ «درس» (schoolContentLessons.ts) — عمداً nullable، دقیقاً به همان
   * دلیلِ `subject` بالا: آیتم‌هایِ از‌قبل‌موجود (قبل از این ستون) و
   * آیتم‌هایِ عمداً بدونِ‌درس باید همچنان کار کنند، نه این‌که با این migration
   * ناپدید/غیرقابل‌دسترس شوند. بدونِ FKِ دیتابیسی (مثلِ schoolId بالا) —
   * همان قراردادِ این فایل: محدودسازی/اعتبارسنجیِ واقعی در لایه‌ی اپلیکیشن
   * (routes/schoolContentLessons.ts) انجام می‌شود.
   */
  lessonId: text("lesson_id"),
  createdByUserId: text("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSchoolContentItemSchema = createInsertSchema(schoolContentItemsTable).omit({ createdAt: true, updatedAt: true });
export type SchoolContentItem = typeof schoolContentItemsTable.$inferSelect;
export type InsertSchoolContentItem = z.infer<typeof insertSchoolContentItemSchema>;
