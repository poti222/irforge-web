/**
 * TutorialLinksCallout.tsx — کادر زرد لینک‌های آموزشی (IRFORGE_PROMPT_V3 Phase 21).
 *
 * لیستِ `tutorialLinks` را که سوپرادمین از پنل «تنظیمات سایت» مدیریت می‌کند
 * (ببینید SupportLinksSettings.tsx) در فضای کاری هر بات نشان می‌دهد — یک
 * نقطه‌ی طبیعی برای onboarding، جایی که مالک بات تازه وارد شده.
 *
 * همان رنگ‌بندیِ زرد/amber که در سراسر سایت برای «هشدار/نکته‌ی مهم» استفاده
 * می‌شود (dashboard.tsx's ANNOUNCEMENT_STYLES.warning). اگر سوپرادمین همه‌ی
 * لینک‌ها را پاک کند، این کامپوننت چیزی رندر نمی‌کند — نه یک کادر خالی.
 */
import { GraduationCap, ArrowUpRight } from "lucide-react";
import { useSupportLinks } from "@/config/support";
import { useLanguage } from "@/hooks/use-language";

export function TutorialLinksCallout() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { tutorialLinks } = useSupportLinks();

  if (tutorialLinks.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
      <div className="flex items-start gap-3">
        <GraduationCap className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-medium">
            {fa ? "تازه‌کاری؟ این‌ها را ببین" : "New here? Check these out"}
          </p>
          <div className="flex flex-wrap gap-2">
            {tutorialLinks.map((link) => (
              <a
                key={link.id}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-background/60 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-background"
              >
                {link.label}
                <ArrowUpRight className="size-3" aria-hidden="true" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
