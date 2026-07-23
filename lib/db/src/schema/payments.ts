/**
 * schema/payments.ts
 * GROUP 2 MIGRATION — جدول جدید
 * فیش‌های واریزی که کاربران هنگام ساخت بات ارسال می‌کنند.
 */
import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const paymentsTable = pgTable("payments", {
  id: text("id").primaryKey(),

  /** کاربری که فیش ارسال کرده */
  userId: text("user_id").notNull(),

  /** مبلغ پرداختی به تومان (Z3 — برای نمایش در فاکتورها). nullable برای رکوردهای قدیمی */
  amount: integer("amount"),

  /**
   * بات مرتبط — nullable تا بعد از تأیید.
   * موقع ثبت، botId بات در وضعیت pending_payment ست می‌شه.
   */
  botId: text("bot_id"),

  /**
   * URL یا base64 عکس فیش واریزی.
   * MVP: base64 ذخیره می‌شه.
   * آینده: لینک S3/R2 بعد از آپلود.
   */
  receiptUrl: text("receipt_url").notNull(),

  /** توضیح اختیاری کاربر درباره پرداخت */
  description: text("description"),

  /**
   * وضعیت بررسی:
   *   pending  → هنوز بررسی نشده
   *   approved → تأیید شده توسط سوپرادمین
   *   rejected → رد شده
   */
  status: text("status").notNull().default("pending"),

  /** ID سوپرادمینی که بررسی کرده (nullable تا بررسی نشده) */
  reviewedBy: text("reviewed_by"),

  /** یادداشت سوپرادمین هنگام رد یا تأیید */
  reviewNote: text("review_note"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ createdAt: true, updatedAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
