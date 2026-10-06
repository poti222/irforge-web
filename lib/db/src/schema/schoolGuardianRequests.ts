/**
 * schema/schoolGuardianRequests.ts — درخواستِ اتصالِ والد به دانش‌آموز با «شماره‌یِ تلفنِ دانش‌آموز».
 * ─────────────────────────────────────────────────────────────────────────
 * والد شماره را وارد می‌کند؛ اگر در همان مدرسه دانش‌آموزی با این شماره باشد، به او اعلان می‌رسد و او تأیید/رد می‌کند.
 * هر ارسال (حتی شماره‌یِ بی‌صاحب) یک ردیف است تا سقفِ ۳ بار و سقفِ ضدِ شمارش‌گریِ ۱۰ شماره/۲۴ساعت قابلِ اعمال باشد.
 * `studentMemberId` برایِ شماره‌یِ بی‌صاحب NULL است و کلاینت هرگز تفاوتِ «پیدا شد/نشد» را نمی‌بیند.
 * `submissionId`: اگر یک شماره به چند دانش‌آموز بخورد (خواهر/برادرِ هم‌شماره) چند ردیف ساخته می‌شود ولی یک «ارسال» حساب می‌شود.
 * وضعیت‌ها: pending | approved | rejected | expired | cancelled — انقضا (۷ روز) lazily اعمال می‌شود.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const schoolGuardianRequestsTable = pgTable("school_guardian_requests", {
  id: text("id").primaryKey(),
  submissionId: text("submission_id").notNull(),
  schoolId: text("school_id").notNull(),
  parentUserId: text("parent_user_id").notNull(),
  studentMemberId: text("student_member_id"),
  normalizedPhone: text("normalized_phone").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export type SchoolGuardianRequest = typeof schoolGuardianRequestsTable.$inferSelect;
