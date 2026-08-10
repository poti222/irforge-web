import { useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Sun, Moon } from "lucide-react";
import { useThemeSweep } from "@/hooks/use-theme-sweep";

/**
 * Z7/W2: a single animated icon that morphs between sun and moon (rotate +
 * scale), PLUS a slow, deliberate color sweep that expands from this button's
 * own corner across the whole page via the View Transitions API — the same
 * technique Telegram uses for its dark-mode toggle. Snaps instantly (icon
 * swap only, no sweep) under prefers-reduced-motion or in browsers without
 * View Transitions support (older Safari/Firefox).
 */
export function ThemeToggleButton({ className = "" }: { className?: string }) {
  const reduce = useReducedMotion();
  const btnRef = useRef<HTMLButtonElement>(null);
  // The sweep itself lives in useThemeSweep so the sidebar menu can produce an
  // identical one from its own element.
  const { isDark, toggleTheme } = useThemeSweep();

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={() => toggleTheme(btnRef.current)}
      aria-label="Toggle theme"
      className={`relative inline-flex size-9 items-center justify-center overflow-hidden rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-primary hover:text-primary ${className}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={isDark ? "moon" : "sun"}
          className="absolute inline-flex"
          initial={reduce ? { opacity: 0 } : { rotate: -90, scale: 0.4, opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { rotate: 0, scale: 1, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { rotate: 90, scale: 0.4, opacity: 0 }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 250, damping: 20 }}
        >
          {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
