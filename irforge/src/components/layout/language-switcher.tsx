import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Check, Languages } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLanguage } from "@/hooks/use-language";
import { LANGUAGES } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * منوی انتخاب زبان با ۵ گزینه (en/fa/ar/tr/ru).
 * از DropdownMenuContent (Radix + tailwindcss-animate) برای fade/zoom استفاده
 * می‌کنه، و هر آیتم با framer-motion به‌صورت staggered وارد می‌شه. انتخاب
 * زبان جدید همون کراس‌فید صفحه‌ای که useLanguage/setLang با View Transitions
 * API انجام می‌ده رو trigger می‌کنه.
 */
export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { lang, setLang } = useLanguage();
  const reduce = useReducedMotion();
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
          {LANGUAGES.map((l, i) => {
            const active = l.code === lang;
            return (
              <DropdownMenuItem
                key={l.code}
                onSelect={(e) => {
                  e.preventDefault();
                  if (!active) setLang(l.code);
                }}
                className="p-0 focus:bg-transparent"
              >
                <motion.div
                  initial={reduce ? false : { opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={reduce ? { duration: 0 } : { duration: 0.18, delay: i * 0.03, ease: "easeOut" }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm transition-colors",
                    active ? "bg-primary/10 text-primary" : "hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <span className="text-base leading-none">{l.flag}</span>
                  <span className="flex-1 text-start">{l.nativeName}</span>
                  {active && (
                    <motion.span
                      initial={reduce ? false : { scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.15 }}
                    >
                      <Check className="size-3.5" />
                    </motion.span>
                  )}
                </motion.div>
              </DropdownMenuItem>
            );
          })}
        </AnimatePresence>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
