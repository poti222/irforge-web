/**
 * useDraft.ts — «state محلی + ذخیره‌ی صریح» به‌شکلی که در همه‌ی تب‌ها یکسان باشد.
 *
 * قرارداد: پیش‌نویس از سرور مقداردهی می‌شود، تا وقتی کاربر چیزی عوض نکرده
 * `dirty=false` است (پس دکمه‌ی ذخیره خاموش)، و وقتی داده‌ی سرور عوض شد **فقط
 * اگر پیش‌نویس دست‌نخورده باشد** خودش را به‌روز می‌کند — وگرنه یک refetch در
 * پس‌زمینه، چیزی که کاربر نصفه تایپ کرده را پاک می‌کرد.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUnsavedGuard } from "@/lib/unsaved-changes";

export type Draft<T> = {
  value: T;
  set: <K extends keyof T>(key: K, next: T[K]) => void;
  replace: (next: T) => void;
  reset: () => void;
  /**
   * «ذخیره موفق شد» — بعد از هر ذخیره‌ی موفق صدا زده شود.
   *
   * بدون این، پیش‌نویس بعد از ذخیره **همیشه dirty می‌ماند**: افکتِ همگام‌سازی
   * عمداً وقتی کاربر تغییری داده جلوی خودش را می‌گیرد تا refetchهای پس‌زمینه
   * تایپ نیمه‌کاره را پاک نکنند — ولی همان شرط، پاسخِ خودِ ذخیره را هم بلوکه
   * می‌کرد. و چون سرور مقدارها را نرمال‌سازی می‌کند (یوزرنیم trim می‌شود،
   * `updated_at` عوض می‌شود، بولی‌های خرابِ شیت درست می‌شوند)، مقایسه‌ی
   * بعدی هم مساوی درنمی‌آمد. نتیجه: نوار «تغییرات ذخیره‌نشده» می‌ماند و
   * موقع خروج از صفحه هشدار می‌داد — با اینکه همه‌چیز ذخیره شده بود.
   */
  markSaved: () => void;
  dirty: boolean;
};

export function useDraft<T extends Record<string, unknown>>(
  guardKey: string,
  source: T | undefined
): Draft<T> {
  const [value, setValue] = useState<T | undefined>(source);
  const dirtyRef = useRef(false);
  /** یک‌بارمصرف: «داده‌ی بعدیِ سرور را بپذیر، حتی اگر پیش‌نویس dirty باشد». */
  const acceptNextRef = useRef(false);

  /**
   * امضای **محتوایی** منبع، نه هویتش.
   *
   * همه‌ی صداکننده‌ها `source` را با یک `pick(data.settings)` درجا می‌سازند،
   * یعنی هر رندر یک آبجکت تازه با محتوای یکسان. اگر افکتِ همگام‌سازی به
   * هویت آبجکت وابسته باشد، هر رندر یک‌بار اجرا می‌شود و `setValue` با یک
   * آبجکت تازه دوباره رندر می‌سازد — حلقه‌ی بی‌پایانِ رندر، که در عمل به شکل
   * «سوئیچ‌ها همدیگر را خراب می‌کنند» دیده می‌شود، چون هر تغییر state وسط
   * همین حلقه گم می‌شود.
   *
   * با کلیدِ سریال‌شده، افکت فقط وقتی اجرا می‌شود که سرور **واقعاً** چیز
   * دیگری برگردانده باشد.
   */
  const sourceKey = source ? JSON.stringify(source) : "";

  const dirty = useMemo(() => {
    if (!source || !value) return false;
    return sourceKey !== JSON.stringify(value);
  }, [sourceKey, source, value]);
  dirtyRef.current = dirty;

  // داده‌ی تازه از سرور فقط وقتی پیش‌نویس را جابه‌جا می‌کند که کاربر چیزی
  // تغییر نداده باشد. بدون این شرط، هر invalidate در پس‌زمینه ورودی نیمه‌کاره‌ی
  // کاربر را می‌کشت.
  useEffect(() => {
    if (!source) return;
    if (value === undefined || !dirtyRef.current || acceptNextRef.current) {
      setValue(source);
      acceptNextRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  useUnsavedGuard(guardKey, dirty);

  /**
   * پیش‌نویس فوراً به `source` فعلی برمی‌گردد تا نوار همان لحظه پاک شود، و
   * پرچم باز می‌ماند تا پاسخِ سرور (که چند میلی‌ثانیه بعد با invalidate
   * می‌رسد و ممکن است نرمال‌سازی‌شده باشد) هم پذیرفته شود.
   */
  const markSaved = useCallback(() => {
    acceptNextRef.current = true;
    setValue(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  const set = useCallback(<K extends keyof T>(key: K, next: T[K]) => {
    setValue((prev) => (prev ? { ...prev, [key]: next } : prev));
  }, []);

  const replace = useCallback((next: T) => setValue(next), []);
  // `reset` هم به امضای محتوایی گره می‌خورد، نه هویت — وگرنه هر رندر یک
  // تابع تازه می‌ساخت و هر مصرف‌کننده‌ای که در وابستگی‌هایش بگذاردش دوباره
  // اجرا می‌شد.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reset = useCallback(() => setValue(source), [sourceKey]);

  return { value: (value ?? source ?? ({} as T)) as T, set, replace, reset, markSaved, dirty };
}
