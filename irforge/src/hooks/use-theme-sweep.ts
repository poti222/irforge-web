import { useTheme } from "next-themes";
import { useRunViewTransition } from "@/hooks/use-view-transition";

/**
 * The circular colour sweep behind the theme toggle, extracted so every place
 * that flips the theme gets the identical animation instead of calling
 * `setTheme` raw.
 *
 * `toggleTheme(originEl)` expands the new theme from the centre of `originEl`
 * (the button, the menu item — whatever the user actually clicked) out to the
 * farthest viewport corner. With no element, or when the element isn't
 * measurable, it falls back to a plain `setTheme`.
 *
 * Reduced-motion and no-View-Transitions fallbacks live in
 * `useRunViewTransition`, which runs the update synchronously in both cases —
 * so this hook never needs to branch on them itself.
 */
export function useThemeSweep() {
  const { theme, setTheme } = useTheme();
  const runViewTransition = useRunViewTransition();
  const isDark = theme === "dark";

  function toggleTheme(originEl?: Element | null) {
    const next = isDark ? "light" : "dark";
    const rect = originEl?.getBoundingClientRect();
    if (!rect) {
      setTheme(next);
      return;
    }

    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    // Pythagorean radius from the origin to the viewport's farthest corner.
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
            // deliberately slower than the 300ms UI timing elsewhere (W1/W4)
            duration: 650,
            easing: "ease-out",
            pseudoElement: "::view-transition-new(root)",
          }
        );
      }
    );
  }

  return { isDark, toggleTheme };
}
