import { motion, useReducedMotion } from "framer-motion";
import { Check } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useLanguage } from "@/hooks/use-language";
import { LANGUAGES } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * The five language rows (flag + native name + a Check on the active one),
 * shared by the header's `LanguageSwitcher` and the sidebar user menu's
 * language submenu so the two can't drift apart.
 *
 * Renders `DropdownMenuItem`s only — the caller supplies the surrounding
 * `DropdownMenuContent` or `DropdownMenuSubContent`.
 */
export function LanguageOptions({ onSelected }: { onSelected?: () => void } = {}) {
  const { lang, setLang } = useLanguage();
  const reduce = useReducedMotion();

  return (
    <>
      {LANGUAGES.map((l, i) => {
        const active = l.code === lang;
        return (
          <DropdownMenuItem
            key={l.code}
            onSelect={(e) => {
              e.preventDefault();
              if (!active) setLang(l.code);
              onSelected?.();
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
    </>
  );
}
