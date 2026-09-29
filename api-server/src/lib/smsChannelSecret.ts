/**
 * lib/smsChannelSecret.ts — secretِ webhookِ هر کانالِ پرداخت
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۳).
 *
 * secret یک مقدارِ تصادفیِ ۲۵۶بیتی است (نه رمزِ انسانی)، پس SHA-256 کافی است
 * — bcrypt/scrypt برایِ ورودیِ کم‌آنتروپی است و اینجا فقط هزینه‌ی هر
 * پیامک را بالا می‌برد. خودِ secret هرگز ذخیره نمی‌شود (فقط هش)، و فقط یک‌بار
 * موقعِ ساخت/چرخش به فروشنده نشان داده می‌شود (فاز ۷).
 *
 * مقایسه constant-time است، و برایِ کانالِ ناموجود هم یک مقایسه‌ی ساختگی
 * انجام می‌شود تا زمانِ پاسخ، وجودِ کانال را لو ندهد.
 */
import crypto from "crypto";

export const SMS_SECRET_PREFIX = "irfsms_";

export function generateSmsSecret(): string {
  return SMS_SECRET_PREFIX + crypto.randomBytes(32).toString("base64url");
}

export function hashSmsSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
}

const DUMMY_HASH = hashSmsSecret("dummy-secret-for-constant-time-compare");

/** `storedHash` می‌تواند null باشد (کانالِ ناموجود) — همچنان یک مقایسه‌ی کامل انجام می‌شود. */
export function verifySmsSecret(provided: string, storedHash: string | null | undefined): boolean {
  const a = Buffer.from(hashSmsSecret(provided), "hex");
  const b = Buffer.from(storedHash && /^[0-9a-f]{64}$/.test(storedHash) ? storedHash : DUMMY_HASH, "hex");
  const equal = crypto.timingSafeEqual(a, b);
  return equal && Boolean(storedHash);
}
