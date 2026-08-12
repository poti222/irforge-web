/**
 * unsaved-changes.ts — یک رجیستری کوچک برای «این صفحه تغییر ذخیره‌نشده دارد».
 * ─────────────────────────────────────────────────────────────────────────────
 * باگ B1 در بات: ویرایش پنل تا وقتی «✅ ذخیره» زده نشود هیچ‌جا ذخیره نمی‌شود و
 * اگر کاربر وسط کار جای دیگری برود، همه‌چیز از FSM می‌پرد — بدون هیچ هشداری.
 * سایت همان مدل «state محلی + دکمه‌ی ذخیره‌ی صریح» را دارد (که درست است)، ولی
 * موظف است قبل از دور ریختن کار کاربر بپرسد.
 *
 * چرا رجیستری ماژولی و نه فقط یک هوک محلی: ناوبری داخل workspace با دکمه‌های
 * سایدبار انجام می‌شود (`navigate()`)، نه با `<a>` — پس نه `beforeunload`
 * می‌گیردش و نه یک listener روی کلیکِ لینک‌ها. آن دکمه‌ها قبل از حرکت
 * `confirmDiscardUnsaved()` را صدا می‌زنند.
 */
import { useEffect } from "react";

const dirtyKeys = new Set<string>();

/** پیام هشدار — از locale پر می‌شود تا اینجا رشته‌ی فارسی hardcode نشود. */
let discardMessage = "تغییرات ذخیره‌نشده دارید. اگر ادامه دهید از بین می‌روند.";

export function setDiscardMessage(message: string): void {
  if (message) discardMessage = message;
}

export function markUnsaved(key: string, dirty: boolean): void {
  if (dirty) dirtyKeys.add(key);
  else dirtyKeys.delete(key);
}

export function hasUnsavedChanges(): boolean {
  return dirtyKeys.size > 0;
}

/**
 * `true` یعنی «برو»، `false` یعنی «کاربر منصرف شد».
 * عمداً `window.confirm` است: ناوبری همزمان (sync) اتفاق می‌افتد و یک دیالوگ
 * async اینجا یعنی صفحه قبل از جواب کاربر عوض شده. برای سوییچ تب — که کنترلش
 * کاملاً دست ماست — از `AlertDialog` استفاده می‌شود، نه از این.
 */
export function confirmDiscardUnsaved(): boolean {
  if (!hasUnsavedChanges()) return true;
  if (typeof window === "undefined") return true;
  const ok = window.confirm(discardMessage);
  if (ok) dirtyKeys.clear();
  return ok;
}

/**
 * ثبت وضعیت dirty یک فرم + هشدار مرورگر هنگام بستن/refresh تب.
 * `key` باید بین رندرها پایدار باشد (مثلاً `settings:general:<botId>`).
 */
export function useUnsavedGuard(key: string, dirty: boolean): void {
  useEffect(() => {
    markUnsaved(key, dirty);
    return () => markUnsaved(key, false);
  }, [key, dirty]);

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // مرورگرهای مدرن متن سفارشی را نادیده می‌گیرند و پیام عمومی خودشان را
      // نشان می‌دهند؛ مقدار برگشتی فقط برای مرورگرهای قدیمی است.
      e.returnValue = discardMessage;
      return discardMessage;
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}
