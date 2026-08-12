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
  dirty: boolean;
};

export function useDraft<T extends Record<string, unknown>>(
  guardKey: string,
  source: T | undefined
): Draft<T> {
  const [value, setValue] = useState<T | undefined>(source);
  const dirtyRef = useRef(false);

  const dirty = useMemo(() => {
    if (!source || !value) return false;
    return JSON.stringify(source) !== JSON.stringify(value);
  }, [source, value]);
  dirtyRef.current = dirty;

  // داده‌ی تازه از سرور فقط وقتی پیش‌نویس را جابه‌جا می‌کند که کاربر چیزی
  // تغییر نداده باشد. بدون این شرط، هر invalidate در پس‌زمینه ورودی نیمه‌کاره‌ی
  // کاربر را می‌کشت.
  useEffect(() => {
    if (!source) return;
    if (value === undefined || !dirtyRef.current) setValue(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  useUnsavedGuard(guardKey, dirty);

  const set = useCallback(<K extends keyof T>(key: K, next: T[K]) => {
    setValue((prev) => (prev ? { ...prev, [key]: next } : prev));
  }, []);

  const replace = useCallback((next: T) => setValue(next), []);
  const reset = useCallback(() => setValue(source), [source]);

  return { value: (value ?? source ?? ({} as T)) as T, set, replace, reset, dirty };
}
