/**
 * schema/auth.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * جدول‌های جریان ثبت‌نام/ورودِ دومرحله‌ای، محدودسازی نرخ، نشست مهمان و
 * لاگ ممیزی ادمین.
 *
 * نکته‌ی امنیتی مشترک همه‌ی این جدول‌ها: **هیچ‌جا کدِ خام ذخیره نمی‌شود.**
 * فقط sha256 آن (`codeHash`) نگه‌داری می‌شود و مقایسه هم timing-safe انجام
 * می‌گیرد — ببینید api-server/src/lib/otp.ts.
 */
import { pgTable, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

/**
 * ثبت‌نام نیمه‌کاره.
 *
 * چرا یک جدول جدا و نه یک ردیف `users` با فلگ؟ چون تا لحظه‌ی آخر هیچ کاربری
 * وجود ندارد: ایمیل و شماره هنوز یکتا نشده‌اند، رمزی وجود ندارد، و یک ردیف
 * نیم‌بند در `users` هر شمارش کاربر و هر کوئری صورت‌حساب را آلوده می‌کرد.
 *
 * دو ساعتِ متفاوت روی این ردیف کار می‌کنند و نباید با هم اشتباه شوند:
 *   - `codeExpiresAt` → ۵ دقیقه، عمر خودِ کد.
 *   - `expiresAt`     → ۷ روز، عمر خودِ رکورد، تا ثبت‌نام‌های رهاشده در پنل
 *                        ادمین (فاز ۱۰) دیده شوند.
 */
export const pendingRegistrationsTable = pgTable("pending_registrations", {
  id: text("id").primaryKey(),

  // ─── گام ۲: هویت ───────────────────────────────────────────
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),

  // ─── گام ۳: از سمت تلگرام پر می‌شود ────────────────────────
  /** E.164 نرمال‌شده — از دکمه‌ی request_contact، یعنی تأییدشده‌ی خودِ تلگرام */
  phone: text("phone"),
  telegramId: text("telegram_id"),
  telegramChatId: text("telegram_chat_id"),
  telegramUsername: text("telegram_username"),
  telegramFirstName: text("telegram_first_name"),
  telegramLastName: text("telegram_last_name"),
  telegramPhotoFileId: text("telegram_photo_file_id"),

  // ─── کد یک‌بارمصرف ─────────────────────────────────────────
  /** sha256 کد — هرگز متن خام */
  codeHash: text("code_hash"),
  codeExpiresAt: timestamp("code_expires_at", { withTimezone: true }),
  codeAttempts: integer("code_attempts").notNull().default(0),
  codeSentCount: integer("code_sent_count").notNull().default(0),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),

  /** identity | telegram_pending | code_sent | code_verified | completed */
  step: text("step").notNull().default("identity"),

  /** زبان کاربر، تا پیام‌های بات به زبان خودش باشد */
  locale: text("locale"),

  /**
   * فقط برای بررسی سوءاستفاده. هرگز در هیچ پاسخ کاربری یا پنل ادمین نمایش
   * داده نمی‌شود و هرگز به ردیف `users` منتقل نمی‌شود.
   */
  sourceIp: text("source_ip"),
  userAgent: text("user_agent"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/**
 * چالش ورود (کد دوم بعد از شماره+رمز).
 *
 * عمداً از `users.resetCodeHash` جداست: اگر یکی بودند، یک کدِ بازیابی رمز
 * می‌توانست یک ورود را تأیید کند و برعکس — دو جریان با سطح اعتماد متفاوت
 * نباید کد همدیگر را مصرف کنند.
 */
export const loginChallengesTable = pgTable("login_challenges", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  codeHash: text("code_hash").notNull(),
  codeExpiresAt: timestamp("code_expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

/**
 * محدودسازی نرخ.
 *
 * وضعیت در **دیتابیس** است نه حافظه‌ی پروسه: سرویس روی Railway اجرا می‌شود و
 * یک ری‌استارت یا یک اینستنس دوم نباید شمارنده را صفر کند — وگرنه محدودیت
 * فقط یک ری‌استارت با آن فاصله دارد.
 */
export const authRateLimitsTable = pgTable("auth_rate_limits", {
  /** مثل "ip:1.2.3.4" یا "phone:+98..." */
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow(),
  blockedUntil: timestamp("blocked_until", { withTimezone: true }),
});

/**
 * نشست مهمان (فاز ۱۱).
 *
 * عمداً ردیف `users` نیست: یک کاربر با `role: "guest"` با ایندکس یکتای شماره
 * تداخل می‌کرد، هر شمارش کاربر و کوئری صورت‌حساب را آلوده می‌کرد، و روت ورود
 * را برای همیشه مجبور می‌کرد ردیف‌های بدون رمز را استثنا کند.
 */
export const guestSessionsTable = pgTable("guest_sessions", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  locale: text("locale"),
  /** وقتی مهمان ثبت‌نام کرد، به کدام کاربر تبدیل شد */
  convertedUserId: text("converted_user_id"),
});

/**
 * لاگ ممیزی اقدامات ادمین (فازهای ۸ و ۱۳).
 *
 * هر اقدام حساسِ ادمین — ریست تلگرام، تغییر رمز، تغییر نقش، جعل هویت — یک
 * ردیف اینجا می‌سازد. لاگی که کسی نتواند بخواندش تزئین است، پس صفحه‌ی جزئیات
 * کاربر یک تب برای همین دارد.
 */
export const adminAuditLogTable = pgTable("admin_audit_log", {
  id: text("id").primaryKey(),
  actorUserId: text("actor_user_id").notNull(),
  action: text("action").notNull(),
  targetUserId: text("target_user_id"),
  /** دلیلِ تایپ‌شده‌ی ادمین برای اقدامات مخرب */
  reason: text("reason"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PendingRegistration = typeof pendingRegistrationsTable.$inferSelect;
export type LoginChallenge = typeof loginChallengesTable.$inferSelect;
export type AuthRateLimit = typeof authRateLimitsTable.$inferSelect;
export type GuestSession = typeof guestSessionsTable.$inferSelect;
export type AdminAuditLogEntry = typeof adminAuditLogTable.$inferSelect;

/** گام‌های ثبت‌نام، به‌ترتیب. تنها سرور این مقدار را جلو می‌برد. */
export const REGISTRATION_STEPS = [
  "identity",
  "telegram_pending",
  "code_sent",
  "code_verified",
  "completed",
] as const;
export type RegistrationStep = (typeof REGISTRATION_STEPS)[number];
