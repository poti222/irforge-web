import { AnimatePresence } from "framer-motion";
import { Languages } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LanguageOptions } from "@/components/layout/language-options";
import { useLanguage } from "@/hooks/use-language";
import { LANGUAGES } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * منوی انتخاب زبان با ۵ گزینه (en/fa/ar/tr/ru).
 * از DropdownMenuContent (Radix + tailwindcss-animate) برای fade/zoom استفاده
 * می‌کنه، و هر آیتم با framer-motion به‌صورت staggered وارد می‌شه. انتخاب
 * زبان جدید همون کراس‌فید صفحه‌ای که useLanguage/setLang با View Transitions
 * API انجام می‌ده رو trigger می‌کنه.
 *
 * ردیف‌های زبان در `LanguageOptions` مشترک‌اند تا منوی کناری هم دقیقاً همین
 * ظاهر را داشته باشد.
 */
export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { lang } = useLanguage();
  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:border-primary hover:text-primary hover:bg-primary/5 data-[state=open]:border-primary data-[state=open]:text-primary",
            className
          )}
          aria-label="Change language"
        >
          <Languages className="size-3.5" />
          <span className="hidden sm:inline">{current.nativeName}</span>
          <span className="sm:hidden">{current.flag}</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[10rem] p-1">
        <AnimatePresence>
          <LanguageOptions />
        </AnimatePresence>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
