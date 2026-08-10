/**
 * schema/users.ts
 * FIX [Group 2 migration]: اضافه شد phone و profileComplete
 */
import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  avatar: text("avatar"),
  role: text("role").notNull().default("user"),
  // role های ممکن: "user" | "admin" | "super_admin"
  plan: text("plan").notNull().default("free"),
  bio: text("bio"),

  // ─── تلگرام ───────────────────────────────────────────────
  telegramId: text("telegram_id").unique(),
  telegramUsername: text("telegram_username"),
  telegramFirstName: text("telegram_first_name"),
  telegramLastName: text("telegram_last_name"),
  telegramPhotoUrl: text("telegram_photo_url"),
  /**
   * file_id از تلگرام برای عکس پروفایل — فقط وقتی اتصال از طریق بات (webhook
   * /start <token>) انجام شده، چون آپدیت‌های بات فقط file_id می‌دن نه یک URL
   * عمومی. برای نمایش این عکس باید از GET /api/users/:id/telegram-photo رد شد
   * (پراکسی که با TELEGRAM_BOT_TOKEN فایل رو از تلگرام می‌گیره)، چون URL واقعی
   * فایل تلگرام شامل توکن بات می‌شه و نباید مستقیم به مرورگر لو بره.
   */
  telegramPhotoFileId: text("telegram_photo_file_id"),

  // ─── GROUP 2 MIGRATION: فیلدهای جدید ────────────────────
  /**
   * شماره موبایل به فرمت E.164.
   *
   * از فاز ۱ به بعد این یک **شناسه‌ی ورود** است، پس در دیتابیس یکتاست — ولی با
   * یک ایندکس یکتای **جزئی** (`WHERE phone IS NOT NULL`)، چون ردیف‌های قدیمی
   * ممکن است شماره نداشته باشند و در Postgres چند NULL با هم تداخل ندارند.
   * ایندکس در مایگریشن ساخته می‌شود، نه اینجا با `.unique()`، تا شرط جزئی‌اش
   * حفظ شود.
   */
  phone: text("phone"),
  /**
   * آیا شماره از طریق دکمه‌ی request_contact تلگرام تأیید شده؟
   * شماره‌ای که کاربر دستی تایپ کرده هرگز این را true نمی‌کند.
   */
  phoneVerified: boolean("phone_verified").notNull().default(false),
  /**
   * یوزرنیم اختصاصی پلتفرم (نه تلگرام) — برای آینده.
   * فعلاً nullable، بعداً می‌تونه unique بشه.
   */
  platformUsername: text("platform_username"),
  /**
   * آیا پروفایل کامل است؟ (تلگرام وصل + شماره + آواتار)
   * می‌شه computed هم نگه داشت ولی boolean ستون سریع‌تره.
   */
  profileComplete: boolean("profile_complete").notNull().default(false),

  // ─── V2: password recovery (code delivered via the platform Telegram bot) ──
  /** sha256 hash of the short-lived reset code (never store it plaintext) */
  resetCodeHash: text("reset_code_hash"),
  /** expiry of the current reset code */
  resetCodeExpiresAt: timestamp("reset_code_expires_at", { withTimezone: true }),

  status: text("status").notNull().default("active"),

  // ─── تریال ۷ روزه ─────────────────────────────────────────
  /** آیا این کاربر قبلاً از تریال رایگان استفاده کرده؟ (هر اکانت فقط یک‌بار) */
  hasUsedTrial: boolean("has_used_trial").notNull().default(false),

  lastLogin: timestamp("last_login", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

/**
 * تابع کمکی برای محاسبه وضعیت profileComplete.
 * هر بار تلگرام لینک می‌شه یا phone آپدیت می‌شه صدا بزن.
 */
export function computeProfileComplete(user: Partial<User>): boolean {
  return Boolean(user.telegramId && user.avatar);
  // بعداً: && user.phone
}
