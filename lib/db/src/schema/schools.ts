/**
 * schema/schools.ts — بخش "/schools" (فاز ۱: زیرساخت).
 * ─────────────────────────────────────────────────────────────────────────
 * سه جدول: خودِ مدرسه، کدهای معرف (برای پیوستن/پیدا کردن یک مدرسه)، و
 * پروفایل مدرسه‌ایِ هر کاربر (نقش/پایه/کد ملی/…) — که کاملاً جدا از ویزارد
 * هویتِ سراسریِ `users`/`complete-profile.tsx` است: آن یکی برای کل سایت
 * اجباری است، این یکی فقط دروازه‌ی ورود به `/schools/*` است.
 */
import { pgTable, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const schoolsTable = pgTable("schools", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /**
   * برای URLهای خواناتر در فازهای بعدی (مثلاً /schools/s/dabirestan-1)؛
   * یکتاییِ آن با یک ایندکس یکتای جزئی در مایگریشن اعمال می‌شود (همان الگوی
   * `users.phone`/`users.platformUsername`)، چون تا قبل از این فاز هیچ
   * مدرسه‌ای وجود نداشته و مقداردهیِ آن اختیاری می‌ماند.
   */
  slug: text("slug"),
  address: text("address"),
  /** آپلود عکس در فاز ۱ خارج از محدوده است — فقط ستونِ nullable برای URL. */
  photoUrl: text("photo_url"),
  city: text("city"),
  /** «مجوزها» — متنِ آزاد (شماره/نوعِ مجوز)، ساختارِ دقیق‌تر برای فازهای بعد. */
  licenseInfo: text("license_info"),
  /** کاربری که این مدرسه را ساخته (معمولاً مدیر) — بدون FK سخت، مطابق قراردادِ همین فایل‌ها (مثلاً `products.createdBy`). */
  createdByUserId: text("created_by_user_id").notNull(),
  /**
   * فازِ ۱۰ (بندِ ۱.۳): آستانه‌یِ غیبتِ پیاپی که اخطارِ خودکار صادر می‌کند —
   * nullable تا مدارسِ قدیمی بدونِ مایگریشنِ backfill هم مقدارِ پیش‌فرض (۳) را
   * در لایه‌ی اپلیکیشن بگیرند (`?? 3` در routes/schoolAttendance.ts)، نه یک
   * ستونِ NOT NULL که یک UPDATE دسته‌جمعی لازم دارد.
   */
  consecutiveAbsenceAlertThreshold: integer("consecutive_absence_alert_threshold"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/**
 * کدِ معرفِ یک مدرسه — هم به‌عنوان یک ویجتِ مستقل کنار سایدبار («پیدا کردن
 * مدرسه») و هم به‌عنوان یک فیلد در فرمِ اطلاعاتِ اولیه استفاده می‌شود. معادلِ
 * ساده‌شده‌ی `roleInviteCodes` در school-app: اگر `role` پر باشد، کد فقط
 * همان نقش را می‌دهد (مثلاً کدِ مخصوصِ معلم‌ها)؛ اگر خالی باشد، صرفاً برای
 * «پیوستن به این مدرسه» است و نقش را خودِ کاربر در فرم انتخاب می‌کند.
 */
export const schoolInviteCodesTable = pgTable("school_invite_codes", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schoolsTable.id),
  code: text("code").notNull().unique(),
  /** nullable — role های ممکن: "admin" | "deputy" | "deputy_discipline" | "counselor" | "teacher" | "student" | "parent" */
  role: text("role"),
  createdByUserId: text("created_by_user_id").notNull(),
  active: boolean("active").notNull().default(true),
  /**
   * فازِ ۹ (بندِ ۲): انقضا/سقفِ مصرف — هر دو nullable/اختیاری (کدِ بدونِ این
   * دو، دقیقاً مثلِ قبل، تا وقتی active باشد بی‌نهایت‌بار قابلِ‌استفاده است).
   * enforcement در routes/schools.ts (`POST /api/schools/onboarding`) با
   * همان الگویِ تراکنشیِ claimFreeSchoolBotToken (schoolBots.ts) انجام
   * می‌شود تا دو کاربرِ هم‌زمان آخرین استفاده‌ی مجاز را دوبار مصرف نکنند.
   */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  maxUses: integer("max_uses"),
  usesCount: integer("uses_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * پروفایلِ مدرسه‌ایِ کاربر — دقیقاً یک ردیف به ازایِ هر `userId` (یکتاییِ آن
 * در مایگریشن اعمال می‌شود). `schoolId` تا وقتی کاربر با یک کدِ معرف به
 * مدرسه‌ای بپیوندد nullable می‌ماند؛ `profileComplete` مثلِ
 * `users.profileComplete` فقط کشِ محاسبه‌ی `computeSchoolProfileComplete()`
 * پایین همین فایل است.
 */
export const schoolMembersTable = pgTable("school_members", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  schoolId: text("school_id").references(() => schoolsTable.id),
  /** role های ممکن: "admin" | "deputy" | "deputy_discipline" | "counselor" | "teacher" | "student" | "parent" */
  role: text("role"),
  /** پایه‌ی تحصیلی — فقط برای role="student" معنا دارد */
  grade: text("grade"),
  nationalId: text("national_id"),
  birthDate: timestamp("birth_date", { withTimezone: true }),
  /** شهرِ سکونت — جدا از `schools.city` (شهرِ خودِ مدرسه) */
  city: text("city"),
  /**
   * برای وقتی کاربر اسمِ مدرسه را قبل از پیداکردن/تطبیق‌دادنش تایپ می‌کند —
   * رابطه‌ی واقعی همچنان `schoolId` بالاست؛ این فقط یک یادداشتِ متنی است تا
   * وقتی مدرسه‌ی واقعی (با کدِ معرف) پیدا شود.
   */
  schoolNameFreeText: text("school_name_free_text"),
  profileComplete: boolean("profile_complete").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSchoolSchema = createInsertSchema(schoolsTable).omit({ createdAt: true, updatedAt: true });
export const insertSchoolInviteCodeSchema = createInsertSchema(schoolInviteCodesTable).omit({ createdAt: true });
export const insertSchoolMemberSchema = createInsertSchema(schoolMembersTable).omit({ createdAt: true, updatedAt: true });

export type School = typeof schoolsTable.$inferSelect;
export type SchoolInviteCode = typeof schoolInviteCodesTable.$inferSelect;
export type SchoolMember = typeof schoolMembersTable.$inferSelect;
export type InsertSchool = z.infer<typeof insertSchoolSchema>;
export type InsertSchoolInviteCode = z.infer<typeof insertSchoolInviteCodeSchema>;
export type InsertSchoolMember = z.infer<typeof insertSchoolMemberSchema>;

/** role های معتبرِ عضویتِ مدرسه‌ای — هم روی فرانت و هم بک‌اند استفاده می‌شود. */
export const SCHOOL_MEMBER_ROLES = [
  "admin",
  "deputy",
  "deputy_discipline",
  "counselor",
  "teacher",
  "student",
  "parent",
] as const;
export type SchoolMemberRole = (typeof SCHOOL_MEMBER_ROLES)[number];

/**
 * محاسبه‌ی `profileComplete` برایِ پروفایلِ مدرسه‌ای — معادلِ
 * `computeProfileComplete()` در schema/users.ts، اما با قوانینِ سبک‌تر: فقط
 * نقش، شهر، تاریخ تولد و کدِ ملی اجباری‌اند (این‌ها برای هر نقشی لازم است)؛
 * `grade` فقط وقتی نقش «دانش‌آموز» باشد اجباری می‌شود، و `schoolId` عمداً
 * اینجا نیست — کاربر می‌تواند فرمِ اولیه را بدون کدِ معرف کامل کند (بعداً از
 * ویجتِ «پیدا کردن مدرسه» می‌پیوندد) و همچنان صفحه‌ی نقشِ خودش را ببیند.
 */
export function computeSchoolProfileComplete(member: Partial<SchoolMember>): boolean {
  const hasRole = Boolean(member.role) && (SCHOOL_MEMBER_ROLES as readonly string[]).includes(member.role as string);
  if (!hasRole) return false;
  const gradeOk = member.role !== "student" || Boolean(member.grade);
  return Boolean(
    hasRole &&
    gradeOk &&
    member.nationalId &&
    member.birthDate &&
    member.city,
  );
}
