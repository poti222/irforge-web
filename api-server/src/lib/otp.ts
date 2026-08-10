/**
 * lib/otp.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * تنها پیاده‌سازی کدهای یک‌بارمصرف در این کدبیس.
 *
 * سه قاعده‌ای که این فایل وجود دارد تا در یک جا رعایت شوند:
 *
 *  ۱. تولید کد با `crypto.randomInt` است، نه `Math.random`. خروجی
 *     `Math.random` قابل پیش‌بینی است و برای یک کد امنیتی اساساً رد است.
 *  ۲. کد هرگز خام ذخیره نمی‌شود — فقط sha256 آن.
 *  ۳. مقایسه timing-safe است. مقایسه‌ی `===` روی رشته‌ها به‌محض اولین بایت
 *     متفاوت برمی‌گردد، و همان اختلاف زمانی به مهاجم اجازه می‌دهد کد را
 *     بایت‌به‌بایت حدس بزند.
 */
import crypto from "crypto";

/** طول کد. ۶ رقم = یک میلیون حالت — تنها با محدودسازی نرخ امن است (فاز ۷). */
export const CODE_LENGTH = 6;

/** عمر کد: ۵ دقیقه. */
export const CODE_TTL_MS = 5 * 60 * 1000;

/** حداکثر تلاش برای یک کد، بعد از آن رکورد/چالش می‌میرد. */
export const MAX_CODE_ATTEMPTS = 5;

/** حداکثر ارسال مجدد برای یک رکورد، و حداقل فاصله بین دو ارسال. */
export const MAX_CODE_SENDS = 3;
export const RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * کد ۶ رقمی با منبع تصادفیِ رمزنگارانه.
 * `randomInt` بازه‌ی بالا را حذف می‌کند، پس بازه‌ی امن 0..999999 است و با
 * padStart به ۶ رقم می‌رسد (کدی مثل "000042" کاملاً معتبر است).
 */
export function generateCode(): string {
  return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

/**
 * sha256 کد. نمک ثابت است چون هدف اینجا مقاومت در برابر جدول رنگین‌کمانی
 * نیست — کد ۵ دقیقه عمر دارد و فضایش کوچک است؛ هدف این است که یک نشتِ
 * فقط-خواندنی از دیتابیس کدِ در جریان را لو ندهد.
 */
export function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code.trim() + "irforge_otp").digest("hex");
}

/**
 * مقایسه‌ی timing-safe بین کد واردشده و هشِ ذخیره‌شده.
 * هر دو طرف قبل از مقایسه به هش تبدیل می‌شوند، پس طولشان همیشه یکسان است و
 * `timingSafeEqual` هرگز به‌خاطر اختلاف طول throw نمی‌کند.
 */
export function verifyCode(input: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || typeof input !== "string" || input.trim() === "") return false;
  const a = Buffer.from(hashCode(input), "utf8");
  const b = Buffer.from(storedHash, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** آیا این زمان انقضا گذشته است؟ */
export function isExpired(expiresAt: Date | null | undefined): boolean {
  return !expiresAt || expiresAt.getTime() <= Date.now();
}

/** زمان انقضای یک کد تازه. */
export function codeExpiry(): Date {
  return new Date(Date.now() + CODE_TTL_MS);
}

/**
 * دروازه‌ی «اکو کردن کد در پاسخ» برای توسعه‌ی محلی.
 *
 * پیش‌فرض خاموش است و در production نباید اصلاً وجود داشته باشد. هرجا صدا زده
 * شود، خروجی‌اش فقط وقتی کد را برمی‌گرداند که متغیر محیطی صریحاً روشن باشد.
 */
export function devEchoCode(code: string): { devCode?: string } {
  return process.env.AUTH_DEV_ECHO_CODES === "true" ? { devCode: code } : {};
}

/** هشدار بوت وقتی اکوی کد روشن است — نباید بی‌سروصدا در جایی روشن بماند. */
export function warnIfDevEchoEnabled(log: { warn: (msg: string) => void }): void {
  if (process.env.AUTH_DEV_ECHO_CODES === "true") {
    log.warn(
      "AUTH_DEV_ECHO_CODES=true — one-time codes are being returned in API responses. " +
        "This MUST NOT be set in production.",
    );
  }
}

/**
 * نرمال‌سازی شماره به E.164.
 *
 * ورودی از دکمه‌ی request_contact تلگرام می‌آید و معمولاً بدون `+` است.
 * شماره‌های ایرانی که با 0 شروع می‌شوند به +98 تبدیل می‌شوند؛ بقیه فقط
 * تمیز و با + پیشوند می‌گیرند. اگر چیزی قابل نرمال‌سازی نبود null برمی‌گردد
 * و صدا زننده باید ردش کند — نه اینکه یک رشته‌ی بی‌شکل را شناسه‌ی ورود کند.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d+]/g, "");
  if (digits === "") return null;
  let out = digits.startsWith("+") ? digits.slice(1) : digits;
  out = out.replace(/\D/g, "");
  if (out === "") return null;
  // 0912... → 98912...
  if (out.startsWith("0")) out = "98" + out.slice(1);
  if (out.length < 8 || out.length > 15) return null;
  return "+" + out;
}
