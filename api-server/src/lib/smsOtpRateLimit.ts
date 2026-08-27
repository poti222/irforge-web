/**
 * lib/smsOtpRateLimit.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * IRFORGE_SMS_OTP_PROMPT — Phase 3: rate limiting و کنترل هزینه برای
 * `POST /auth/otp/sms/send` (فاز ۴، هنوز نوشته نشده — این فایل زیرساختی
 * است که آن روت هنگام ساخته‌شدن مستقیماً import می‌کند).
 *
 * چرا یک فایل جدا و نه منطق داخل خودِ روت:
 * سه سقفِ مستقل باید همزمان چک شوند (کول‌داون شماره، سقفِ ۱۰دقیقه‌ایِ شماره،
 * سقفِ روزانه‌ی شماره، سقفِ ساعتیِ IP) و ترتیب/پیام هرکدام باید یک‌جا و
 * قابل‌تست باشد، نه پخش‌شده لابه‌لای کد یک روت Express.
 *
 * چرا از `middleware/rateLimit.ts` (همان `hit()`/جدولِ `auth_rate_limits`)
 * استفاده شده، نه شمارشِ مستقیمِ ردیف‌های `sms_otp_codes`:
 * پرامپت گفته «اگه Redis... هست ازش استفاده کن، وگرنه با همون جدول
 * Postgres پیاده کن» — این کدبیس از قبل دقیقاً چنین جدولی
 * (`auth_rate_limits`) و یک تابعِ pure/تست‌پذیر (`hit`) برای همین منظور
 * دارد (لاگین، rate limit تلگرام و غیره). یک شمارنده‌ی دوم و موازی روی
 * `sms_otp_codes` یعنی دو مکانیزمِ rate-limit با رفتار متفاوت در یک
 * کدبیس؛ همان الگوی موجود را برای شماره/IP این فیچر هم دوباره استفاده
 * می‌کنیم — دقیقاً همان چیزی که «از الگوی موجود کدبیس پیروی کن» می‌خواهد.
 * (ستونِ `sms_otp_codes.sent_count` برای فازِ دیگری‌ست: شمارشِ ارسالِ مجدد
 * *در همان نشستِ OTP* — همان الگوی `pending_registrations.code_sent_count`
 * + `MAX_CODE_SENDS`/`RESEND_COOLDOWN_MS` در `lib/otp.ts` — و کارِ روتِ
 * فازِ ۴ است، نه این فایل.)
 *
 * چهار سقف، به همان ترتیبی که چک می‌شوند (اولین موردِ رد‌شده تصمیم را
 * می‌گیرد):
 *   ۱. کول‌داون ۶۰ ثانیه‌ای بینِ دو درخواستِ متوالی برای همان شماره —
 *      همان `RESEND_COOLDOWN_MS` که `lib/otp.ts` برای ثبت‌نام هم دارد؛
 *      اینجا هم عدد و هم معنایش یکی است، فقط دامنه فرق دارد.
 *   ۲. حداکثر ۳ درخواست در ۱۰ دقیقه برای همان شماره.
 *   ۳. حداکثر ۱۰ درخواست در ۲۴ ساعت برای همان شماره.
 *   ۴. حداکثر ۱۰ درخواست در ساعت برای همان IP (سقفِ سراسری‌تر — جلوی
 *      اسکن‌کردنِ شماره‌های زیاد از یک IP را می‌گیرد؛ سقف‌های بالا به تنهایی
 *      این را نمی‌گیرند چون per-phone هستند).
 *
 * هر چهار سقف روی `hit()` سوار هستند: پنجره‌ی ثابت، بدونِ `blockMs` اضافه
 * (یعنی به‌محضِ گذشتنِ پنجره، شمارنده خودش صفر می‌شود — نیازی به یک دورانِ
 * قفلِ اضافه‌تر مثلِ بلاکِ لاگین نیست، چون این محدودیتِ *ارسال* است، نه
 * محدودیتِ *حدسِ رمز*).
 */
import type { NextFunction, Request, Response } from "express";
import { clientIp, hit, type HitFn } from "../middleware/rateLimit";
import { normalizePhone, RESEND_COOLDOWN_MS } from "./otp";
import { logger } from "./logger";

/** حداکثر ۳ درخواست OTP در ۱۰ دقیقه، برای یک شماره. */
export const SMS_OTP_PHONE_10M_LIMIT = 3;
export const SMS_OTP_PHONE_10M_WINDOW_MS = 10 * 60 * 1000;

/** حداکثر ۱۰ درخواست OTP در روز، برای یک شماره. */
export const SMS_OTP_PHONE_DAILY_LIMIT = 10;
export const SMS_OTP_PHONE_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** حداکثر ۱۰ درخواست OTP در ساعت، برای یک IP. */
export const SMS_OTP_IP_HOURLY_LIMIT = 10;
export const SMS_OTP_IP_HOURLY_WINDOW_MS = 60 * 60 * 1000;

/**
 * کول‌داونِ بینِ دو درخواستِ متوالی برای همان شماره — عمداً همان
 * `RESEND_COOLDOWN_MS` (۶۰ ثانیه) از `lib/otp.ts`، تا فرانت‌اند بتواند
 * همان تایمرِ شمارش‌معکوسِ ۶۰ ثانیه‌ایِ فازِ ۵ را بدونِ عددِ دومی که باید
 * جدا هماهنگ نگه‌داشته شود، دوباره استفاده کند.
 */
export const SMS_OTP_COOLDOWN_MS = RESEND_COOLDOWN_MS;

export type SmsOtpRateLimitReason = "cooldown" | "phone_10m" | "phone_daily" | "ip_hourly";

export interface SmsOtpRateLimitVerdict {
  allowed: boolean;
  reason?: SmsOtpRateLimitReason;
  retryAfterSeconds?: number;
}

function cooldownKey(phone: string): string {
  return `sms-otp-cooldown:${phone}`;
}
function phone10mKey(phone: string): string {
  return `sms-otp-phone-10m:${phone}`;
}
function phoneDailyKey(phone: string): string {
  return `sms-otp-phone-day:${phone}`;
}
function ipHourlyKey(ip: string): string {
  return `sms-otp-ip:${ip}`;
}

/**
 * چهار سقف را به‌ترتیب چک می‌کند و روی اولین موردِ ردشده متوقف می‌شود.
 *
 * `phone` باید از قبل نرمال‌شده باشد (`normalizePhone` در `lib/otp.ts`)؛
 * اگر `null`/خالی است (یعنی هنوز اعتبارسنجیِ فرمتِ شماره رد نشده)، فقط
 * سقفِ IP چک می‌شود — رد کردنِ یک شمارهٔ نامعتبر با پیامِ "rate limited"
 * به‌جای پیامِ واقعیِ اعتبارسنجی، فقط کاربر را گیج می‌کند؛ آن خطا کارِ
 * خودِ روتِ فازِ ۴ است.
 *
 * هیچ‌کدام از این ضربه‌ها روی موفقیت reset نمی‌شوند — برخلافِ
 * rate-limitِ لاگینِ ناموفق، اینجا «موفقیت» یعنی «یک پیامک رفت»، که خودش
 * دقیقاً همان چیزی است که این سقف‌ها می‌خواهند محدودش کنند.
 */
export async function checkSmsOtpSendRateLimit(
  phone: string | null,
  sourceIp: string,
  hitFn: HitFn = hit,
): Promise<SmsOtpRateLimitVerdict> {
  if (phone) {
    const cooldown = await hitFn(cooldownKey(phone), 1, 0, SMS_OTP_COOLDOWN_MS);
    if (!cooldown.allowed) {
      return { allowed: false, reason: "cooldown", retryAfterSeconds: cooldown.retryAfterSeconds };
    }

    const tenMin = await hitFn(phone10mKey(phone), SMS_OTP_PHONE_10M_LIMIT, 0, SMS_OTP_PHONE_10M_WINDOW_MS);
    if (!tenMin.allowed) {
      return { allowed: false, reason: "phone_10m", retryAfterSeconds: tenMin.retryAfterSeconds };
    }

    const daily = await hitFn(phoneDailyKey(phone), SMS_OTP_PHONE_DAILY_LIMIT, 0, SMS_OTP_PHONE_DAILY_WINDOW_MS);
    if (!daily.allowed) {
      return { allowed: false, reason: "phone_daily", retryAfterSeconds: daily.retryAfterSeconds };
    }
  }

  const hourly = await hitFn(ipHourlyKey(sourceIp), SMS_OTP_IP_HOURLY_LIMIT, 0, SMS_OTP_IP_HOURLY_WINDOW_MS);
  if (!hourly.allowed) {
    return { allowed: false, reason: "ip_hourly", retryAfterSeconds: hourly.retryAfterSeconds };
  }

  return { allowed: true };
}

const RATE_LIMIT_MESSAGES: Record<SmsOtpRateLimitReason, string> = {
  cooldown: "لطفاً پیش از درخواستِ کدِ دیگر کمی صبر کنید.",
  phone_10m: "تعداد درخواست‌های کد برای این شماره زیاد بوده. کمی بعد دوباره تلاش کنید.",
  phone_daily: "امروز به سقفِ درخواستِ کد برای این شماره رسیده‌اید. فردا دوباره تلاش کنید.",
  ip_hourly: "تعداد درخواست‌ها از این دستگاه زیاد بوده. کمی بعد دوباره تلاش کنید.",
};

/**
 * پاسخِ ۴۲۹ استاندارد را می‌فرستد — همان شکلِ بدنه و هدرِ `Retry-After`ی
 * که بقیه‌ی rate limitهای auth (`middleware/rateLimit.ts`) برمی‌گردانند
 * (`error`, `code: "rate_limited"`, `retryAfterSeconds`)، به‌علاوه‌ی
 * `reason` تا فرانت‌اند (فازِ ۵) بتواند پیامِ مناسب را بدونِ حدس‌زدن از
 * رویِ متنِ فارسی نشان دهد. عمداً به‌جایِ فراخوانیِ `send429` (که فیلدِ
 * `reason` را نمی‌شناسد) خودش هدر و بدنه را می‌سازد.
 */
export function sendSmsOtpRateLimited(res: Response, verdict: SmsOtpRateLimitVerdict): void {
  const reason = verdict.reason ?? "ip_hourly";
  const retryAfterSeconds = verdict.retryAfterSeconds ?? 60;
  res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterSeconds))));
  res.status(429).json({
    error: RATE_LIMIT_MESSAGES[reason],
    code: "rate_limited",
    reason,
    retryAfterSeconds,
  });
}

/**
 * میدل‌ورِ آماده برای `POST /auth/otp/sms/send` (فازِ ۴).
 *
 * شماره را از `req.body?.phone` می‌خواند و با همان `normalizePhone`ی که
 * بقیه‌ی مسیرهای auth استفاده می‌کنند نرمال می‌کند — اگر نامعتبر بود،
 * فقط سقفِ IP چک می‌شود (توضیح در `checkSmsOtpSendRateLimit`). اگر مجاز
 * بود `next()` صدا زده می‌شود و روت خودش مسئولِ اعتبارسنجیِ باقیِ ورودی،
 * تولید/ذخیره/ارسالِ کد است — این میدل‌ور فقط دروازه‌ی نرخ است، نه
 * اعتبارسنجیِ کامل.
 */
export function smsOtpSendRateLimit(hitFn: HitFn = hit) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const phone = normalizePhone(req.body?.phone);
      const verdict = await checkSmsOtpSendRateLimit(phone, clientIp(req), hitFn);
      if (!verdict.allowed) {
        sendSmsOtpRateLimited(res, verdict);
        return;
      }
      next();
    } catch (err) {
      // همان قاعده‌ی `hit()`: اگر خودِ محدودساز خراب شود، اجازه می‌دهیم —
      // قفل‌کردنِ کل مسیرِ OTP به‌خاطرِ یک خطای این میدل‌ور بدتر از از
      // دست‌دادنِ موقتِ محدودیت است.
      logger.error({ err }, "smsOtpSendRateLimit failed (allowing request)");
      next();
    }
  };
}
