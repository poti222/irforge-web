import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-translation";

/**
 * ورودی کد ۶ رقمی — مشترک بین ثبت‌نام و ورود.
 *
 * چند نکته که این کامپوننت وجود دارد تا در هر دو جا یکسان رعایت شوند:
 *
 *  - **هر خانه برچسب خودش را دارد.** شش جعبه‌ی بی‌برچسب با صفحه‌خوان عملاً
 *    غیرقابل استفاده‌اند؛ `aria-label` هرکدام شماره‌ی رقم را می‌گوید.
 *  - `inputMode="numeric"` و `autoComplete="one-time-code"` تا روی موبایل
 *    کیبورد عددی بیاید و کد از پیامک/تلگرام auto-fill شود.
 *  - **جهت همیشه LTR است**، حتی در فارسی و عربی: کد یک عدد است و ترتیب
 *    ارقامش نباید با جهت متن صفحه برعکس شود.
 */
export const CODE_LENGTH = 6;

export function CodeInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
}: {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const t = useT("auth") as Record<string, string>;
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [focused, setFocused] = useState(0);

  const digits = value.padEnd(CODE_LENGTH, " ").slice(0, CODE_LENGTH).split("");

  useEffect(() => {
    if (value.length === CODE_LENGTH) onComplete?.(value);
    // فقط وقتی کد کامل شد؛ onComplete هر رندر تازه است.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function setAt(index: number, char: string) {
    const next = value.padEnd(CODE_LENGTH, " ").split("");
    next[index] = char;
    onChange(next.join("").replace(/\s/g, "").slice(0, CODE_LENGTH));
  }

  function handleChange(index: number, raw: string) {
    const clean = raw.replace(/\D/g, "");
    if (clean === "") {
      setAt(index, " ");
      return;
    }
    // چند رقم یک‌جا (paste یا auto-fill) از همین خانه پخش می‌شود.
    if (clean.length > 1) {
      const merged = (value.slice(0, index) + clean).replace(/\D/g, "").slice(0, CODE_LENGTH);
      onChange(merged);
      const target = Math.min(merged.length, CODE_LENGTH - 1);
      refs.current[target]?.focus();
      return;
    }
    const next = value.split("");
    next[index] = clean;
    onChange(next.join("").slice(0, CODE_LENGTH));
    if (index < CODE_LENGTH - 1) refs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !value[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
    // فلش‌ها همیشه بر حسب ترتیبِ رقم‌ها حرکت می‌کنند، نه جهت صفحه.
    if (e.key === "ArrowLeft" && index > 0) refs.current[index - 1]?.focus();
    if (e.key === "ArrowRight" && index < CODE_LENGTH - 1) refs.current[index + 1]?.focus();
  }

  return (
    <div className="flex justify-center gap-2" dir="ltr" role="group" aria-label={t.codeGroupLabel}>
      {Array.from({ length: CODE_LENGTH }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          disabled={disabled}
          value={digits[i]?.trim() ?? ""}
          aria-label={(t.codeDigitLabel ?? "Digit {n}").replace("{n}", String(i + 1))}
          aria-invalid={invalid || undefined}
          onFocus={() => setFocused(i)}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          className={cn(
            "size-12 rounded-lg border bg-background text-center text-xl font-semibold tabular-nums outline-none transition-colors",
            "focus:border-primary focus:ring-2 focus:ring-primary/30",
            invalid && "border-destructive",
            focused === i && !invalid && "border-primary",
            disabled && "opacity-60",
          )}
        />
      ))}
    </div>
  );
}
