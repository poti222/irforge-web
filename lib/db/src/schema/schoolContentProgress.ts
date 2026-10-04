/**
 * schema/schoolContentProgress.ts — پیشرفتِ مطالعه‌یِ دانش‌آموز رویِ یک آیتمِ
 * کتابخانه‌ی محتوا (فعلاً لغت‌نامه/شعر)، طبقِ گزارشِ مستقیمِ کاربر: نسخه‌ی
 * فلش‌کارت/SRSِ ریپویِ dars کاملاً سمتِ کلاینت (localStorage) بود و با پاک‌شدنِ
 * مرورگر یا عوض‌کردنِ دستگاه از بین می‌رفت. این جدول دقیقاً همان شکافِ کیفی
 * است: پیشرفت روی سرور، به‌ازایِ (آیتم، دانش‌آموز)، تا با دانش‌آموز جابه‌جا شود.
 *
 * ── چرا `studentMemberId` نه «فقط دانش‌آموز»؟ ───────────────────────────
 * به‌عمد محدود به role="student" نشده: ستون واقعاً `school_members.id` هر
 * عضوی است که حالتِ مطالعه را استفاده می‌کند (مثلاً معلمی که پیش‌نمایشِ
 * فلش‌کارت‌هایِ خودش را می‌بیند) — محدودسازیِ نقش در لایه‌ی روت است، نه اینجا؛
 * اسمِ ستون برایِ خوانایی (اکثرِ استفاده‌کننده‌ها واقعاً دانش‌آموزند) همین مانده.
 *
 * ── زمان‌بندیِ تکرار (SRS) ───────────────────────────────────────────────
 * طبقِ اسپک، عمداً یک الگوریتمِ SM-2 کامل نیست — یک دنباله‌ی ثابتِ بازه‌ها
 * (`INTERVAL_STEPS_DAYS` در routes/schoolContentProgress.ts) که با هر «بلدم»
 * یک پله جلو می‌رود و با «نیاز به تمرین دارم» به پله‌ی اول برمی‌گردد و
 * `nextReviewAt` را به *الان* ست می‌کند (یعنی بلافاصله در جلسه‌ی بعدی دوباره
 * نشان داده شود) — همان مفهومِ باینریِ ریپویِ dars، فقط سرور-محور.
 */
import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const SCHOOL_CONTENT_RATINGS = ["know", "practice"] as const;
export type SchoolContentRating = (typeof SCHOOL_CONTENT_RATINGS)[number];

export const schoolContentProgressTable = pgTable("school_content_progress", {
  id: text("id").primaryKey(),
  /** school_content_items.id — بدونِ FK سخت، همان قراردادِ بقیه‌یِ این دامنه. */
  contentItemId: text("content_item_id").notNull(),
  /** school_members.id — ببینید توضیحِ بالایِ فایل برایِ این‌که چرا «فقط دانش‌آموز» نیست. */
  studentMemberId: text("student_member_id").notNull(),
  /** آخرین خودارزیابی: "know" (بلدم) | "practice" (نیاز به تمرین دارم) */
  lastRating: text("last_rating").notNull(),
  reviewCount: integer("review_count").notNull().default(0),
  intervalDays: integer("interval_days").notNull().default(1),
  nextReviewAt: timestamp("next_review_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSchoolContentProgressSchema = createInsertSchema(schoolContentProgressTable).omit({ createdAt: true, updatedAt: true });
export type SchoolContentProgress = typeof schoolContentProgressTable.$inferSelect;
export type InsertSchoolContentProgress = z.infer<typeof insertSchoolContentProgressSchema>;
