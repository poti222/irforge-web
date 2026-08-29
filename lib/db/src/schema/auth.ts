/**
 * schema/auth.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * جدول‌های جریان ثبت‌نام/ورودِ دومرحله‌ای، محدودسازی نرخ، نشست مهمان،
 * لاگ ممیزی ادمین، و کدهای OTP پیامکی (sms_otp_codes، IRFORGE_SMS_OTP_PROMPT).
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

  /**
   * IRFORGE_PROMPT_V3 Phase 14 — "phone" (default, every row before this
   * phase) goes through the Telegram deep-link steps below; "email" skips
   * straight from identity to sending a code to `email` and never touches
   * `phone`/`telegram*`. Both share the exact same code_hash/attempts/
   * verify-code/complete machinery below -- this column is what tells the
   * two endpoints that do differ (resend, complete) which path a row is on.
   */
  registrationMethod: text("registration_method").notNull().default("phone"),

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
 * درخواست ورود یک‌کلیکی با تلگرام.
 *
 * جریان: کاربر روی سایت «ورود با تلگرام» را می‌زند → یک ردیف اینجا ساخته
 * می‌شود → با لینک عمیق `t.me/<bot>?start=tglogin_<id>` وارد بات می‌شود →
 * وبهوک کاربر را **از روی `telegram_id` خودِ تلگرام** پیدا می‌کند و ردیف را
 * تأیید می‌کند → مرورگری که در حال poll است، نشست را می‌گیرد.
 *
 * چرا `id` و `pollSecret` دو چیز جدا هستند و نه یک توکن:
 * `id` داخل لینک عمیق است و هرکسی که لینک را ببیند (تاریخچه‌ی مرورگر، یک
 * اسکرین‌شات، شخصی که کاربر لینک را برایش فرستاده) آن را دارد. اگر همان مقدار
 * برای گرفتن نشست کافی بود، دیدنِ لینک یعنی گرفتن حساب. `pollSecret` هرگز از
 * مرورگرِ آغازکننده بیرون نمی‌رود و شرط لازمِ تحویل نشست است.
 *
 * `webTicket` جدا از هر دوست: تنها چیزی است که در دکمه‌ی «داشبورد» داخل پیام
 * بات می‌رود، تا کاربری که روی گوشی بات را باز کرده هم بتواند همان‌جا وارد
 * سایت شود. یک‌بارمصرف، و **بعد** از تأیید ساخته می‌شود نه قبلش.
 */
export const telegramLoginRequestsTable = pgTable("telegram_login_requests", {
  /** همان چیزی که در `/start tglogin_<id>` می‌رود — عمومی فرض می‌شود */
  id: text("id").primaryKey(),
  /** فقط مرورگر آغازکننده دارد؛ شرط لازم برای poll و تحویل نشست */
  pollSecret: text("poll_secret").notNull(),
  /** pending | approved | consumed | rejected */
  status: text("status").notNull().default("pending"),
  /** بعد از تأیید پر می‌شود — کاربری که تلگرامش شناخته شد */
  userId: text("user_id"),
  /** یک‌بارمصرف، فقط برای دکمه‌ی داشبورد داخل پیام بات */
  webTicket: text("web_ticket"),
  webTicketUsedAt: timestamp("web_ticket_used_at", { withTimezone: true }),
  /** چرا رد شد — تا UI پیام درست بدهد، نه یک «منقضی شد» گنگ */
  rejectedReason: text("rejected_reason"),
  locale: text("locale"),
  /** فقط برای بررسی سوءاستفاده — هرگز در پاسخی برنمی‌گردد */
  sourceIp: text("source_ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
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

/**
 * کدهای OTP پیامکی — IRFORGE_SMS_OTP_PROMPT Phase 2.
 *
 * چرا یک جدول جدید و نه گسترش سه جدولِ بالا؟
 * هر کدام از سه جدول بالا مخصوصِ یک کانالِ خاص طراحی شده‌اند: تلگرام (کاربر
 * از داخل بات با دکمه‌ی request_contact تأیید می‌شود) و ایمیل (کد به آدرس
 * ایمیل می‌رود). پیامک یک کانالِ سوم است که — برخلاف تلگرام/ایمیل — باید
 * پشتِ هر سه هدف (ثبت‌نام، ورود، فراموشی رمز) یکسان کار کند، چون فقط یک
 * چیز لازم دارد: یک شماره موبایل. اضافه‌کردنِ فیلدهای پیامکی به
 * `login_challenges` (که جوابش را از `user_id` می‌گیرد) و به `users.reset_code_*`
 * (که با تلگرامِ پلتفرم کار می‌کند) یعنی سه مسیر جدا با فرض‌های متفاوت را
 * برای یک ویژگی ساده به‌هم می‌ریزیم. یک جدولِ مستقل — دقیقاً هم‌شکل با چیزی
 * که پرامپت خواسته (شماره، کد هش‌شده، انقضا، تلاش، هدف) — هر سه هدف را با
 * یک ستون `purpose` پوشش می‌دهد و از سه گلوگاهِ موجود فقط شماره‌ی نرمال‌شده و
 * (وقتی هدف ورود/بازیابی رمز است) `user_id` را قرض می‌گیرد.
 *
 * هش/تولید/مقایسه‌ی کد از همان api-server/src/lib/otp.ts استفاده می‌کند —
 * هیچ منطق رمزنگاری جدیدی اینجا نیست، فقط محل ذخیره‌سازی.
 */
export const smsOtpCodesTable = pgTable("sms_otp_codes", {
  id: text("id").primaryKey(),

  /** شماره‌ی نرمال‌شده به E.164 (همان normalizePhone در lib/otp.ts) */
  phone: text("phone").notNull(),

  /** register | login | password_reset — ببینید SMS_OTP_PURPOSES پایین */
  purpose: text("purpose").notNull(),

  /**
   * برای purpose = login یا password_reset، کاربرِ صاحبِ این کد از قبل
   * وجود دارد و اینجا پر می‌شود — verify باید هم شماره و هم user_id را چک
   * کند، نه فقط شماره را، وگرنه یک کدِ معتبر برای شماره‌ی X می‌توانست
   * حساب Y را هم باز کند اگر شماره‌ها به هر دلیلی (تغییرِ صاحب سیم‌کارت)
   * جا‌به‌جا شده باشند. برای purpose = register همیشه NULL است، چون هنوز
   * کاربری ساخته نشده.
   */
  userId: text("user_id"),

  /** sha256/HMAC کد — هرگز متن خام (ببینید hashCode در lib/otp.ts) */
  codeHash: text("code_hash").notNull(),

  /**
   * پیشنهاد پرامپت ۲ دقیقه است — کوتاه‌تر از پیش‌فرض ۵ دقیقه‌ی تلگرام/ایمیل
   * در lib/otp.ts، چون هر ارسالِ مجدد اینجا هزینه‌ی واقعی پیامک دارد و
   * می‌خواهیم کاربر را به درخواستِ زودهنگامِ کد بعدی تشویق نکنیم. طول عمر
   * در سطح فراخوانی (فاز ۴) تعیین می‌شود، نه اینجا با یک مقدارِ ثابت در
   * اسکیما.
   */
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

  /** حداکثر ۵ تلاش اشتباه (MAX_CODE_ATTEMPTS در lib/otp.ts) قبل از باطل شدن کد */
  attempts: integer("attempts").notNull().default(0),

  /** چندمین ارسال برای همین (phone, purpose) — پایه‌ی rate limit فاز ۳ */
  sentCount: integer("sent_count").notNull().default(1),

  consumedAt: timestamp("consumed_at", { withTimezone: true }),

  /** فقط برای بررسی سوءاستفاده — هرگز در پاسخی برنمی‌گردد */
  sourceIp: text("source_ip"),
  userAgent: text("user_agent"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PendingRegistration = typeof pendingRegistrationsTable.$inferSelect;
export type LoginChallenge = typeof loginChallengesTable.$inferSelect;
export type TelegramLoginRequest = typeof telegramLoginRequestsTable.$inferSelect;
export type AuthRateLimit = typeof authRateLimitsTable.$inferSelect;
export type GuestSession = typeof guestSessionsTable.$inferSelect;
export type AdminAuditLogEntry = typeof adminAuditLogTable.$inferSelect;
export type SmsOtpCode = typeof smsOtpCodesTable.$inferSelect;

/** گام‌های ثبت‌نام، به‌ترتیب. تنها سرور این مقدار را جلو می‌برد. */
export const REGISTRATION_STEPS = [
  "identity",
  "telegram_pending",
  "code_sent",
  "code_verified",
  "completed",
] as const;
export type RegistrationStep = (typeof REGISTRATION_STEPS)[number];

/** مقادیر معتبر ستون `purpose` در sms_otp_codes — سه هدفی که پرامپت خواسته. */
export const SMS_OTP_PURPOSES = ["register", "login", "password_reset"] as const;
export type SmsOtpPurpose = (typeof SMS_OTP_PURPOSES)[number];
