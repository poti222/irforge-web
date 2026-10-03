/**
 * lib/super-stash.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * «بازگشت به حساب من» برای بخشِ C ("/super" → هویت‌های آزمایشی).
 *
 * نشست‌های این کدبیس کوکی نیستند — یک Bearer token در localStorage (نگاه کن
 * lib/auth-token.ts) — پس «استکِ نشستِ سوپرادمین قبل از سوییچ» هم همان‌جا
 * انجام می‌شود: توکنِ واقعیِ سوپرادمین قبل از «ورود به هویتِ آزمایشی» این‌جا
 * ذخیره می‌شود، و این فایل فقط یک محلِ مشترک برایِ کلید + چکِ «آیا الان در
 * حالتِ تست هستیم؟» است، تا هم TestIdentitiesManager هم بنرِ هشدار
 * (TestModeBanner) از یک منبع بخوانند.
 */

export const SUPER_STASH_KEY = "irforge_super_stash_token";

export function getStashedSuperToken(): string | null {
  try {
    return localStorage.getItem(SUPER_STASH_KEY);
  } catch {
    return null;
  }
}

export function clearStashedSuperToken(): void {
  try {
    localStorage.removeItem(SUPER_STASH_KEY);
  } catch {
    /* ignore */
  }
}
