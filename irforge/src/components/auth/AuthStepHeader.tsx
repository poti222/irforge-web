import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";
import { isRtlLang } from "@/lib/i18n";

/**
 * سربرگ مشترک گام‌های ثبت‌نام و ورود: عنوان، توضیح، نشانگر «گام n از N» و
 * دکمه‌ی بازگشت.
 *
 * چرا یک کامپوننت: هر دو صفحه چند گام دارند و کاربر باید در هر لحظه بداند
 * کجای مسیر است و چطور یک قدم عقب برود. تکرار این سه چیز در هفت جا یعنی هفت
 * جا برای ناهماهنگ شدن.
 *
 * فلش بازگشت RTL-aware است: «عقب» در فارسی و عربی یعنی راست.
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
  /** وقتی داده نشود، دکمه‌ی بازگشت رندر نمی‌شود (گام اول). */
  onBack?: () => void;
}) {
  const { lang } = useLanguage();
  const t = useT("auth") as Record<string, string>;
  const BackArrow = isRtlLang(lang) ? ArrowRight : ArrowLeft;

  const indicator = (t.stepIndicator ?? "Step {n} of {total}")
    .replace("{n}", String(step))
    .replace("{total}", String(total));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {onBack && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-ms-2 size-8 shrink-0"
            onClick={onBack}
            aria-label={t.back}
          >
            <BackArrow className="size-4" />
          </Button>
        )}
        {/* aria-live تا صفحه‌خوان تغییر گام را اعلام کند، نه اینکه کاربر
            نابینا بی‌خبر بین مراحل جابه‌جا شود. */}
        <p className="text-xs font-medium text-muted-foreground" aria-live="polite">
          {indicator}
        </p>
      </div>

      {/* نوار پیشرفت تزئینی است؛ عدد واقعی بالا خوانده می‌شود. */}
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i < step ? "bg-primary" : "bg-muted"
            }`}
          />
        ))}
      </div>

      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}
