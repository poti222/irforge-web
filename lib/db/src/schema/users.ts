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
  /** شماره موبایل — اختیاری، توسط کاربر وارد می‌شود */
  phone: text("phone"),
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
