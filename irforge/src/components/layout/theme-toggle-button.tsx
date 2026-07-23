import { useRef } from "react";
import { useTheme } from "next-themes";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Sun, Moon } from "lucide-react";
import { useRunViewTransition } from "@/hooks/use-view-transition";

/**
 * Z7/W2: a single animated icon that morphs between sun and moon (rotate +
 * scale), PLUS a slow, deliberate color sweep that expands from this button's
 * own corner across the whole page via the View Transitions API — the same
 * technique Telegram uses for its dark-mode toggle. Snaps instantly (icon
 * swap only, no sweep) under prefers-reduced-motion or in browsers without
 * View Transitions support (older Safari/Firefox).
 */
export function ThemeToggleButton({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const reduce = useReducedMotion();
  const runViewTransition = useRunViewTransition();
  const btnRef = useRef<HTMLButtonElement>(null);
  const isDark = theme === "dark";

  function handleClick() {
    const next = isDark ? "light" : "dark";
    const btn = btnRef.current;
    if (!btn) {
      setTheme(next);
      return;
    }

    const rect = btn.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    // Pythagorean radius from the toggle's corner to the viewport's farthest corner.
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    runViewTransition(
      () => setTheme(next),
      () => {
        (document.documentElement as any).animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 650, // deliberately slower than the 300ms UI timing elsewhere (W1/W4)
            easing: "ease-out",
            pseudoElement: "::view-transition-new(root)",
          }
        );
      }
    );
  }

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={handleClick}
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
