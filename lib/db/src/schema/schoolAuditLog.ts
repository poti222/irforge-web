/**
 * schema/schoolAuditLog.ts — بخش "/schools" فاز ۹ (بندِ ۳): جدولِ حداقلیِ
 * رخدادنگاریِ اقداماتِ مدیریتی — که در هیچ‌کدام از فازهای ۲ تا ۸ وجود نداشت
 * (تغییرِ نقش/حذفِ عضو/اعطایِ مدیریت/کدِ معرف/صدورِ اخطار، همه بی‌ردِپا بودند).
 * ─────────────────────────────────────────────────────────────────────────
 * عمداً از `admin_audit_log` (جدولِ سراسریِ سوپرادمینِ پلتفرم، برایِ
 * role change/ban و…) استفاده نشد: آن جدول `target_user_id` دارد نه
 * `school_id`، و منطقاً برایِ رخدادهایِ **پلتفرم**ی‌ست، نه رخدادهایِ داخلِ یک
 * مدرسه؛ مخلوط‌کردنشان یعنی صفحه‌ی «تاریخچه‌ی این مدرسه» باید بینِ ردیف‌هایِ
 * بی‌ربطِ کلِ سایت فیلتر کند. `targetDescription` عمداً متنِ آماده‌ی خوانا است
 * (نه فقط یک id خام) — چون این صفحه صرفاً یک لاگِ فقط‌خواندنی‌ست، نیازی به
 * join دوباره برایِ نمایش نیست.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { schoolsTable } from "./schools";

export const schoolAuditLogTable = pgTable("school_audit_log", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schoolsTable.id),
  actorUserId: text("actor_user_id").notNull(),
  /** مثلاً "member.role_changed" | "member.removed" | "admin.granted" | "invite_code.created" | "invite_code.toggled" | "alert.issued" */
  action: text("action").notNull(),
  /** توضیحِ آماده‌ی انسانی — مثلاً «علی محمدی: دانش‌آموز → معلم» */
  targetDescription: text("target_description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSchoolAuditLogSchema = createInsertSchema(schoolAuditLogTable).omit({ createdAt: true });
export type SchoolAuditLog = typeof schoolAuditLogTable.$inferSelect;
export type InsertSchoolAuditLog = z.infer<typeof insertSchoolAuditLogSchema>;
