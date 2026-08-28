import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-translation";
import { useWebOtp } from "@/hooks/use-web-otp";

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
 *  - **ارقام فارسی/عربی هم پذیرفته می‌شوند**: کیبورد فارسی موبایل پیش‌فرض
 *    ۰-۹ فارسی می‌دهد؛ بدون این تبدیل، تایپ مستقیم کد کار نمی‌کرد.
 *  - `webOtp` (پیش‌فرض false): وقتی کد واقعاً به‌صورت پیامک رسیده باشد
 *    (روش «پیامک»، نه تلگرام/ایمیل)، این کامپوننت با WebOTP API (فقط
 *    Chrome/Android) خودش کد را از پیامک می‌خواند و پر می‌کند — بدون خروج
 *    از تب. جزئیات در hooks/use-web-otp.ts.
 */
export const CODE_LENGTH = 6;

/** ۰۱۲۳۴۵۶۷۸۹ فارسی و ٠١٢٣٤٥٦٧٨٩ عربی → ASCII. IRFORGE_PROMPT_V3 Phase 15. */
function foldDigits(raw: string): string {
  return raw.replace(/[۰-۹٠-٩]/g, (ch) => {
    const code = ch.charCodeAt(0);
    // ۰-۹ فارسی: U+06F0–U+06F9. ٠-٩ عربی: U+0660–U+0669.
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

export function CodeInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  errorMessage,
  webOtp = false,
}: {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  /** پیام قابل‌شنیدن برای صفحه‌خوان (aria-live) — مثلاً «کد اشتباه است، ۲ تلاش باقی مانده». */
  errorMessage?: string;
  /**
   * فقط برای گام‌هایی که کد واقعاً با پیامک می‌رسد. روی سایر گام‌ها
   * (تلگرام/ایمیل) این prop اصلاً پاس داده نمی‌شود چون آن پیام‌ها SMS
   * نیستند — WebOTP API چیزی برای گرفتن پیدا نمی‌کرد.
   */
  webOtp?: boolean;
}) {
  const t = useT("auth") as Record<string, string>;
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [focused, setFocused] = useState(0);

  useWebOtp(onChange, webOtp && !disabled);

  const digits = value.padEnd(CODE_LENGTH, " ").slice(0, CODE_LENGTH).split("");

  useEffect(() => {
    if (value.length === CODE_LENGTH) onComplete?.(value);
    // فقط وقتی کد کامل شد؛ onComplete هر رندر تازه است.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // فوکوس روی خانه‌ی اول: هم موقع باز شدن صفحه، هم بعد از یک کد اشتباه —
  // کاربر نباید خودش دنبال خانه‌ی خالی بگردد.
  useEffect(() => {
    refs.current[0]?.focus();
  }, []);
  useEffect(() => {
    if (invalid) refs.current[0]?.focus();
  }, [invalid]);

  function setAt(index: number, char: string) {
    const next = value.padEnd(CODE_LENGTH, " ").split("");
    next[index] = char;
    onChange(next.join("").replace(/\s/g, "").slice(0, CODE_LENGTH));
  }

  function handleChange(index: number, raw: string) {
    const clean = foldDigits(raw).replace(/\D/g, "");
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
    <div className="space-y-2">
      <div className="flex justify-center gap-1.5 sm:gap-2" dir="ltr" role="group" aria-label={t.codeGroupLabel}>
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
              "size-10 rounded-lg border bg-background text-center text-lg font-semibold tabular-nums outline-none transition-colors motion-reduce:transition-none sm:size-12 sm:text-xl",
              "focus:border-primary focus:ring-2 focus:ring-primary/30",
              invalid && "border-destructive",
              focused === i && !invalid && "border-primary",
              disabled && "opacity-60",
            )}
          />
        ))}
      </div>
      {/* فقط برای صفحه‌خوان: خانه‌های قرمزشده به‌تنهایی خطا را اعلام نمی‌کنند. */}
      {invalid && errorMessage && (
        <p role="alert" aria-live="assertive" className="text-center text-sm text-destructive">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
