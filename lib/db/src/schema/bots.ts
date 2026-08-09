/**
 * schema/bots.ts
 * FIX [Group 2 migration]: اضافه شد sheetId, adminCode, paymentStatus, adminCodeUsed
 */
import { pgTable, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const botsTable = pgTable("bots", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),

  /**
   * وضعیت بات:
   *   pending_payment  → درخواست ثبت شده، منتظر تأیید فیش
   *   payment_rejected → فیش رد شده
   *   inactive         → تأیید شده، هنوز فعال نشده
   *   active           → فعال و در حال اجرا
   *   error            → خطا در اتصال
   */
  status: text("status").notNull().default("pending_payment"),

  token: text("token").notNull(),
  userId: text("user_id").notNull(),
  username: text("username"),
  /**
   * آواتار — این ستون هرگز URL خام تلگرام (که توکن بات توش هست) رو نگه
   * نمی‌داره، فقط مسیر پروکسی سمت سرور: `/api/bots/{id}/avatar`.
   * (نگاه کن به fetchBotIdentity در lib/telegram.ts و GET .../avatar پایین‌تر.)
   */
  avatar: text("avatar"),
  /** file_id تلگرامی عکس پروفایل بات — برای resolve کردن file_path در هر بار درخواست پروکسی. */
  avatarFileId: text("avatar_file_id"),

  // آمار
  commandCount: integer("command_count").notNull().default(0),
  pluginCount: integer("plugin_count").notNull().default(0),
  userCount: integer("user_count").notNull().default(0),
  messageCount: integer("message_count").notNull().default(0),

  // ─── GROUP 2 MIGRATION: فیلدهای جدید ────────────────────

  /**
   * ID شیت گوگل اختصاصی این بات.
   * بعد از تأیید پرداخت از Sheet Pool گرفته و اینجا ست می‌شه.
   */
  sheetId: text("sheet_id"),

  /**
   * کد ادمین مخصوص این بات.
   * بعد از تأیید پرداخت توسط سوپرادمین تولید می‌شه.
   * کاربر این کد رو توی پروفایلش وارد می‌کنه تا پنل بات فعال بشه.
   */
  adminCode: text("admin_code"),

  /**
   * آیا adminCode مصرف شده؟
   * چون تصمیم گرفتیم re-usable باشه (هر بار می‌شه وارد کرد)،
   * این فیلد برای آینده نگه داشتیم ولی فعلاً false می‌مونه.
   */
  adminCodeUsed: boolean("admin_code_used").notNull().default(false),

  /**
   * وضعیت پرداخت (جدا از status بات تا واضح‌تر باشه):
   *   pending   → منتظر بررسی
   *   approved  → تأیید شده
   *   rejected  → رد شده
   */
  paymentStatus: text("payment_status").notNull().default("pending"),

  // ─── تریال ۷ روزه (پکیج نقره‌ای رایگان، یک‌بار برای هر کاربر) ────────
  /** آیا این بات از طریق تریال رایگان ساخته شده؟ */
  isTrial: boolean("is_trial").notNull().default(false),
  /** لحظه‌ی پایان تریال — بعد از این تاریخ status به "expired" تغییر می‌کند. */
  trialExpiresAt: timestamp("trial_expires_at", { withTimezone: true }),

  // ─── تسویه‌حساب سبد خرید (/bots/cart): اطلاعات تماس مخصوص این سفارش ───
  // ممکنه با phone/telegramId پروفایل کاربر فرق داشته باشه (مثلاً وقتی
  // کاربر داره برای شخص دیگه‌ای بات می‌سازه)، پس جدا نگه داشته می‌شه.
  /** شماره تلفنی که هنگام خرید این بات وارد شده */
  orderPhone: text("order_phone"),
  /** آیدی تلگرامی که هنگام خرید این بات وارد شده */
  orderTelegramId: text("order_telegram_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBotSchema = createInsertSchema(botsTable).omit({ createdAt: true, updatedAt: true });
export type InsertBot = z.infer<typeof insertBotSchema>;
export type Bot = typeof botsTable.$inferSelect;
