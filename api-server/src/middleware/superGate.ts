/**
 * middleware/superGate.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * دروازه‌ی **عاملِ دومِ** صفحه‌ی `/super`.
 *
 * این یک جایگزین برای ورودِ واقعیِ سوپرادمین نیست — فقط رویِ آن سوار می‌شود:
 * هر مسیری که از `requireSuperGate` استفاده می‌کند باید *همیشه* قبل یا بعدش
 * `requireSuperAdmin` را هم داشته باشد (همان چکِ واقعیِ role=super_admin که
 * routes/auth.ts دارد — اینجا تکرار/دوباره‌نویسی نمی‌شود، فقط import). یعنی
 * برای ورود به `/super` هم باید با حسابِ سوپرادمینِ واقعی لاگین کرده باشی، هم
 * رمزِ این گیت را بدانی. این لایه‌ی اضافه صرفاً یک محافظِ دیگر است برایِ
 * صفحه‌ای که همه‌ی تنظیماتِ حساسِ پلتفرم رویِ آن جمع شده.
 *
 * کوکیِ گیت با HMAC امضا می‌شود (دقیقاً همان الگویِ otp.ts/telegramAuth.ts —
 * `crypto.createHmac`، نه یک کتابخانه‌ی جدید)، چون این کدبیس کوکیِ نشستِ
 * امضاشده‌ای ندارد تا از آن استفاده شود: نشست‌ها Bearer tokenِ تصادفی در
 * جدولِ `sessions` هستند (routes/auth.ts)، نه کوکی. امضا فقط تضمین می‌کند
 * کسی نمی‌تواند با ساختنِ دستیِ یک کوکی به نامِ درست، گیت را دور بزند.
 */
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

export const SUPER_GATE_COOKIE = "irforge_super_gate";
const SUPER_GATE_TTL_MS = 12 * 60 * 60 * 1000; // ۱۲ ساعت

function gateSecret(): string {
  // یک مقدارِ ثابت در dev اگر env ست نشده باشد — فقط برای این‌که تست‌های
  // local بدونِ ست‌کردنِ یک متغیرِ اضافه کار کنند؛ در production همیشه باید
  // SUPER_GATE_SECRET/SESSION را ست کرد (مثلِ هر رازِ دیگرِ این پروژه).
  return process.env.SUPER_GATE_SECRET || process.env.SUPER_ADMIN_CODE || "irforge-super-gate-dev-secret";
}

function sign(value: string): string {
  return crypto.createHmac("sha256", gateSecret()).update(value).digest("hex");
}

function secretEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** مقدارِ کوکی: `<expiresAtMs>.<hmac>` — بدونِ هیچ شناسه‌ی کاربری داخلش، چون
 * این گیت خودش هویت نمی‌دهد، فقط «رمزِ درست را کسی که از قبل لاگینِ سوپرادمین
 * دارد وارد کرده» را یادآوری می‌کند؛ هویتِ واقعی همچنان از Bearer token
 * می‌آید و هر بار با requireSuperAdmin دوباره چک می‌شود. */
export function issueSuperGateCookieValue(): { value: string; maxAge: number } {
  const expiresAt = Date.now() + SUPER_GATE_TTL_MS;
  const payload = String(expiresAt);
  const value = `${payload}.${sign(payload)}`;
  return { value, maxAge: SUPER_GATE_TTL_MS };
}

function isValidGateCookie(raw: string | undefined): boolean {
  if (!raw) return false;
  const idx = raw.lastIndexOf(".");
  if (idx <= 0) return false;
  const payload = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  if (!secretEquals(sig, sign(payload))) return false;
  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt > Date.now();
}

/**
 * میدل‌ورِ مسیرهای `/super/*` — باید *بعد از* `requireSuperAdmin` بیاید
 * (یعنی `req.userId` از قبل یک super_admin واقعی است)، فقط کوکیِ گیت را
 * اضافه چک می‌کند.
 */
export function requireSuperGate(req: Request, res: Response, next: NextFunction) {
  const cookie = (req as any).cookies?.[SUPER_GATE_COOKIE];
  if (!isValidGateCookie(cookie)) {
    res.status(401).json({
      error: "Super gate locked. Enter the /super password first.",
      code: "super_gate_locked",
    });
    return;
  }
  next();
}
