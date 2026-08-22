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
 * IRFORGE_PROMPT_V3 Phase 4.6 — the salt used to be the fixed string
 * "irforge_otp". For a 6-digit code that's a 1,000,000-entry rainbow table
 * anyone can precompute once, offline, in seconds — a read-only DB leak
 * (a backup, a replica, a support export) would recover every pending code
 * immediately. `OTP_SECRET` makes the table useless without also stealing
 * the secret, and rotating it is cheap: it just invalidates in-flight codes,
 * which have a 5-minute TTL anyway.
 *
 * Returns a description of the problem if OTP_SECRET is missing or too
 * short *in production*, else null. A pure function (env passed in rather
 * than always reading `process.env`) so this is testable without process
 * mutation or reload tricks.
 */
export function otpSecretConfigIssue(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env.OTP_SECRET || "";
  if (env.NODE_ENV === "production" && secret.length < 32) {
    return (
      "OTP_SECRET is unset (or shorter than 32 characters) in production. " +
      "Set it to a long random value before boot — see .env.example."
    );
  }
  return null;
}

const _otpSecretIssue = otpSecretConfigIssue();
if (_otpSecretIssue) {
  throw new Error(_otpSecretIssue);
}

// Only reachable in non-production (the guard above already refused to boot
// otherwise) — a fixed, obviously-fake fallback so local dev/tests don't
// need OTP_SECRET configured, and it can never be mistaken for a real one.
const OTP_SECRET = process.env.OTP_SECRET || "dev-only-insecure-otp-secret-do-not-use-in-prod";

/** HMAC-SHA256 کد با `OTP_SECRET`. کد خام هرگز ذخیره نمی‌شود. */
export function hashCode(code: string): string {
  return crypto.createHmac("sha256", OTP_SECRET).update(code.trim()).digest("hex");
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
