import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { isRtlLang } from "@/lib/i18n";

/**
 * سربرگ مشترک گام‌های احراز هویت: کنترل بازگشت، عنوان گام، و نشانگر «گام n از m».
 *
 * جهت فلش از زبان می‌آید، نه از یک ثابت: در فارسی و عربی «قبلی» به راست است.
 * همان منطق `isRtlLang` که قبلاً در `register.tsx`/`login.tsx` تکرار شده بود،
 * حالا فقط یک‌جا زندگی می‌کند.
 *
 * وقتی `onBack` داده نشود جای دکمه **خالی نمی‌ماند بلکه اصلاً رندر نمی‌شود** —
 * یک دکمه‌ی بی‌کار بدتر از نبودنش است. ارتفاع ردیف نشانگر ثابت است تا نبودن
 * دکمه، عنوان را جابه‌جا نکند.
 */
export function AuthStepHeader({
  title,
  description,
  step,
  total,
  onBack,
}: {
  title: string;
  description?: string;
  step: number;
  total: number;
  onBack?: () => void;
}) {
  const t = useT("auth") as Record<string, string>;
  const { lang } = useLanguage();
  const BackArrow = isRtlLang(lang) ? ArrowRight : ArrowLeft;

  const indicator = (t.stepIndicator ?? "Step {n} of {total}")
    .replace("{n}", String(step))
    .replace("{total}", String(total));

  return (
    <div className="space-y-2">
      <div className="flex min-h-9 items-center justify-between gap-3">
        {onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ms-2 h-9 px-2 text-muted-foreground hover:text-foreground"
            onClick={onBack}
          >
            <BackArrow className="me-1.5 size-4" aria-hidden="true" />
            {t.back}
          </Button>
        ) : (
          <span />
        )}
        <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {indicator}
        </span>
      </div>

      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}
