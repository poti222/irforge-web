/**
 * مقصدِ بعد از لاگین/ثبت‌نام. دکمه‌های صفحه‌ی اصلی («ساخت بات» / «سامانه‌ی
 * مدرسه») مقصد را اینجا می‌گذارند و هر مسیرِ ورود (ایمیل، گوگل، گیت‌هاب،
 * تلگرام، تکمیل پروفایل) در پایان `consumePostAuthTarget()` را می‌خواند.
 * sessionStorage برای این است که از ریدایرکتِ OAuth جان سالم به در ببرد.
 */
const KEY = "irforge_post_auth";
const ALLOWED = ["/dashboard", "/schools"];

export function setPostAuthTarget(path: string): void {
  try {
    if (ALLOWED.includes(path)) sessionStorage.setItem(KEY, path);
  } catch {
    /* storage may be blocked */
  }
}

export function peekPostAuthTarget(): string {
  try {
    const v = sessionStorage.getItem(KEY);
    if (v && ALLOWED.includes(v)) return v;
  } catch {
    /* ignore */
  }
  return "/dashboard";
}

export function consumePostAuthTarget(): string {
  const v = peekPostAuthTarget();
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return v;
}
