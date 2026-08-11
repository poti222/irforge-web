import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { usersTable } from "@workspace/db";

/**
 * تنها جای نرمال‌سازی ایمیل در کل سرویس.
 *
 * دو پیاده‌سازی مستقلِ `toLowerCase()` دقیقاً همان چیزی بود که این باگ را ساخت:
 * مسیر ثبت‌نام جدید ایمیل را کوچک می‌کرد و `POST /auth/register` قدیمی دقیقاً
 * همان‌طور که تایپ شده بود ذخیره می‌کرد، پس `Ali@Gmail.com` و `ali@gmail.com`
 * برای Postgres — که بایت‌به‌بایت مقایسه می‌کند — دو رشته‌ی متفاوت بودند و هر
 * دو از کنار قید یکتایی رد می‌شدند.
 *
 * فقط بخش دامنه بی‌حساسیت به بزرگی و کوچکی **استاندارد** است؛ حساسیت بخش محلی
 * از نظر RFC مجاز است. اما هیچ ارائه‌دهنده‌ی واقعی‌ای از آن استفاده نمی‌کند و
 * کاربر هم `Ali@` و `ali@` را یک آدرس می‌داند. کل رشته کوچک می‌شود — همان
 * رفتاری که مسیر ثبت‌نام جدید از قبل داشت — تا داده‌ی موجود نیاز به تفسیر
 * دوباره نداشته باشد.
 */
export function normaliseEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * شرط جست‌وجوی ایمیل، بی‌حساس به بزرگی و کوچکی حروف.
 *
 * `lower(email) = $1` است، نه `ilike`: `ilike` الگو می‌پذیرد و یک `%` در ورودی
 * کاربر آن را به یک جست‌وجوی عمومی تبدیل می‌کرد. این شرط همان چیزی است که
 * ایندکس یکتای تابعی روی `lower(email)` هم بر اساسش ساخته شده، پس جست‌وجو از
 * همان ایندکس استفاده می‌کند.
 *
 * ورودی همیشه از `normaliseEmail` رد می‌شود تا سمت راست مقایسه هم کوچک باشد.
 */
export function emailEquals(value: unknown): SQL {
  return sql`lower(${usersTable.email}) = ${normaliseEmail(value)}`;
}

/**
 * آیا این خطا نقض قید یکتایی ایمیل است؟
 *
 * `23505` کد `unique_violation` در Postgres است. نام قید هم چک می‌شود چون
 * جدول `users` روی شماره هم قید یکتایی دارد و نباید «شماره تکراری» را
 * «ایمیل تکراری» گزارش کنیم.
 */
export function isEmailUniqueViolation(err: unknown): boolean {
  return isUniqueViolationOn(err, ["email"]);
}

/** همان، برای شماره. */
export function isPhoneUniqueViolation(err: unknown): boolean {
  return isUniqueViolationOn(err, ["phone"]);
}

function isUniqueViolationOn(err: unknown, needles: string[]): boolean {
  const e = err as { code?: string; constraint?: string; detail?: string } | null;
  if (!e || e.code !== "23505") return false;
  // `constraint` همیشه پر نیست (بسته به مسیر خطا)، پس `detail` هم دیده می‌شود.
  const haystack = `${e.constraint ?? ""} ${e.detail ?? ""}`.toLowerCase();
  return needles.some((n) => haystack.includes(n));
}
