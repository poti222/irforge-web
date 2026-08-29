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
  /**
   * ایمیل، همیشه با حروف کوچک ذخیره می‌شود (`normaliseEmail` در سرور).
   *
   * یکتایی‌اش با یک ایندکس یکتای **تابعی** روی `lower(email)` در مایگریشن
   * ۰۰۱۸ اعمال می‌شود، نه با `.unique()` اینجا — دقیقاً به همان دلیلی که
   * `phone` پایین‌تر ایندکسش را در مایگریشن دارد: قید ساده‌ی `UNIQUE` در
   * Postgres بایت‌به‌بایت مقایسه می‌کند و `Ali@Gmail.com` را با
   * `ali@gmail.com` دو چیز متفاوت می‌بیند، که همان باگی بود که این ستون را
   * به اینجا رساند.
   */
  email: text("email").notNull(),
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
   * IRFORGE_PROMPT_V3 Phase 14 — آیا ایمیل با یک کدِ واقعاً ارسال‌شده تأیید
   * شده؟ حساب‌های ثبت‌نام‌شده با شماره، ایمیل را در گام هویت جمع می‌کنند ولی
   * هرگز کدی به آن نمی‌فرستند — این ستون برای آن‌ها همیشه false می‌ماند،
   * چون هیچ‌وقت واقعاً تأیید نشده، نه چون فراموش شده باشد.
   */
  emailVerified: boolean("email_verified").notNull().default(false),
  /**
   * یوزرنیم اختصاصی پلتفرم (نه تلگرام) — نمایشی است، هرگز برای ورود استفاده
   * نمی‌شود (ورود همچنان بر پایه‌ی ایمیل/شماره است). nullable تا زمانی که
   * کاربر آن را در ویزارد تکمیل هویت انتخاب کند؛ یکتاییِ آن با یک ایندکس
   * یکتای جزئی در مایگریشن اعمال می‌شود (`WHERE platform_username IS NOT
   * NULL`), دقیقاً همان الگوی phone پایین‌تر — چون ردیف‌های قدیمی این ستون
   * را ندارند و چند NULL نباید با هم برخورد کنند.
   */
  platformUsername: text("platform_username"),
  /**
   * آیا پروفایل کامل است؟ منبعِ حقیقتِ محاسبه در computeProfileComplete()
   * پایین همین فایل است — این ستون فقط کشِ همان محاسبه است، برای کوئری
   * سریع بدون بازمحاسبه‌ی هر بار.
   */
  profileComplete: boolean("profile_complete").notNull().default(false),
  /**
   * جنسیت — "male" | "female"، nullable تا وقتی کاربر آن را در ویزارد
   * تکمیل هویت وارد کند. فقط این دو مقدار مجاز است؛ ورودی نامعتبر همان
   * لحظه‌ی ثبت رد می‌شود (نه اینجا، در validation لایه‌ی route).
   */
  gender: text("gender"),
  /**
   * حساب از کدام سرویسِ OAuth ساخته شده — "google" | "github" | null.
   * تنها جایی که این مقدار خوانده می‌شود exemption رمزِ عبور در
   * computeProfileComplete() است: کسی که با گوگل/گیت‌هاب حساب ساخته یک
   * passwordHash تصادفی و ناشناخته دارد (ببینید GET /auth/google/callback و
   * GET /auth/github/callback)، پس truthy بودنِ passwordHash به‌تنهایی
   * نمی‌تواند «رمز واقعی دارد» را نشان دهد — این ستون آن تمایز را می‌دهد.
   * توجه: در اسپکِ اصلی این ستون قرار بود در schema/auth.ts باشد؛ آنجا
   * چیزی برای OAuth وجود نداشت (نه این فیلد، نه هیچ معادلی)، پس اینجا و به
   * همین نام ساخته شد، کنار بقیه‌ی ستون‌های هویتیِ کاربر.
   */
  oauthProvider: text("oauth_provider"),
  /**
   * فلگ بازبینیِ ادمین — وقتی heuristic نام/جنسیت (identityHeuristics.ts)
   * مغایرت پیدا کند. هرگز مانعِ ثبت‌نام/ورود نمی‌شود؛ فقط حساب را در صفِ
   * بازبینیِ ادمین می‌گذارد. حذفِ خودکار هیچ‌جای این سیستم وجود ندارد —
   * ادمین یا فلگ را پاک می‌کند یا حساب را حذف می‌کند.
   */
  flaggedForReview: boolean("flagged_for_review").notNull().default(false),
  /** "gender_mismatch" | "name_mismatch" | "manual_report" */
  flagReason: text("flag_reason"),
  flaggedAt: timestamp("flagged_at", { withTimezone: true }),
  /**
   * اولین باری که همه‌ی فیلدهای اجباریِ هویت پر شدند — یک‌بار ست می‌شود،
   * هیچ‌وقت آپدیت نمی‌شود. برای گزارش/تحلیل، نه برای خودِ گیت (گیت از
   * computeProfileComplete زنده استفاده می‌کند، نه این timestamp).
   */
  identityCompletedAt: timestamp("identity_completed_at", { withTimezone: true }),
  /**
   * ۲FA اختیاری — کاربر خودش در پروفایل روشن/خاموش می‌کند. روش، همان کانالِ
   * کدِ ورودِ دومرحله‌ایِ موجود (`/auth/login/verify`) است؛ این دو ستون فقط
   * می‌گویند «آیا فعال است» و «از کدام کانال» — منطق ارسال/تأییدِ کد قبلاً
   * در auth.ts هست و دست‌نخورده می‌ماند.
   */
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  /** "email" | "sms" | "telegram" — فقط وقتی twoFactorEnabled=true معنا دارد */
  twoFactorMethod: text("two_factor_method"),

  // ─── V2: password recovery (code delivered via the platform Telegram bot) ──
  /** sha256 hash of the short-lived reset code (never store it plaintext) */
  resetCodeHash: text("reset_code_hash"),
  /** expiry of the current reset code */
  resetCodeExpiresAt: timestamp("reset_code_expires_at", { withTimezone: true }),

  /**
   * آیا اعلان‌های سایت علاوه بر زنگوله‌ی سایت، در تلگرام هم فرستاده شوند؟
   *
   * پیش‌فرض `true` است چون کاربر با اتصال تلگرام عملاً همین را خواسته — ولی
   * تحویل فقط وقتی اتفاق می‌افتد که `telegramId` هم پر باشد (ببینید
   * `api-server/src/lib/notifyTelegram.ts`). خاموش‌کردنش هیچ اثری روی
   * ساخته‌شدن خودِ اعلان در سایت ندارد؛ فقط تحویلِ تلگرامی قطع می‌شود.
   */
  notifyTelegram: boolean("notify_telegram").notNull().default(true),

  status: text("status").notNull().default("active"),

  // ─── تریال ۷ روزه ─────────────────────────────────────────
  /** آیا این کاربر قبلاً از تریال رایگان استفاده کرده؟ (هر اکانت فقط یک‌بار) */
  hasUsedTrial: boolean("has_used_trial").notNull().default(false),
  /**
   * فاز ۱۱ (identityverificationspec.md): بنرِ پیشنهادِ تریال روی داشبورد را
   * بسته/رد کرده؟ یک‌بار true می‌شود و دیگر برنمی‌گردد — یک ستونِ دیتابیس، نه
   * localStorage، چون این یک نکته‌ی یک‌بارِ حساب است، نه ترجیحِ مرورگر (باید
   * روی هر دستگاهی که کاربر واردش می‌شود هم صدق کند).
   */
  hasSeenTrialOffer: boolean("has_seen_trial_offer").notNull().default(false),

  lastLogin: timestamp("last_login", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

/**
 * محاسبه‌ی وضعیتِ profileComplete.
 *
 * ⚠️ این باید همیشه دقیقاً با `checkProfile().complete` در
 * `api-server/src/lib/profile.ts` یکی بماند — آن فایل منبعِ حقیقتِ واقعی
 * است (چون هم برای دروازه‌ی خرید و هم دروازه‌ی اجباریِ تکمیل هویت استفاده
 * می‌شود و جزئیاتِ «چه چیزی کم است» را هم گزارش می‌دهد)، این تابع فقط یک
 * نسخه‌ی boolean-محضِ همان قانون در لایه‌ی schema است، برای جایی که فقط
 * یک بله/خیر لازم است نه لیستِ فیلدهای گم‌شده. تغییرِ قانون در یکی بدون
 * دیگری یعنی این ستون بسته به این‌که کدام مسیر آخرین‌بار نوشته، دو معنیِ
 * متفاوت می‌گیرد.
 *
 * رمزِ عبور برای حساب‌های OAuth استثناست: کسی که با گوگل/گیت‌هاب ساخته
 * شده یک passwordHash تصادفی و ناشناخته دارد (خودِ کاربر هرگز آن را
 * تایپ نکرده)، پس truthy بودنِ passwordHash به‌تنهایی «رمزِ واقعی دارد»
 * را ثابت نمی‌کند — oauthProvider همان تمایز را می‌دهد.
 */
export function computeProfileComplete(user: Partial<User>): boolean {
  const hasPassword = Boolean(user.passwordHash) || Boolean(user.oauthProvider);
  const nameParts = (user.name ?? "").trim().split(/\s+/).filter(Boolean);
  return Boolean(
    nameParts.length >= 2 &&
    user.email &&
    user.phone &&
    user.phoneVerified &&
    user.telegramId &&
    user.telegramUsername &&
    user.gender &&
    user.platformUsername &&
    hasPassword,
  );
}
