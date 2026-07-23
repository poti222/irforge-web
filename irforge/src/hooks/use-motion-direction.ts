import { useLanguage } from "@/hooks/use-language";

/**
 * Y0: RTL-aware direction multiplier for motion.
 *
 * Any Framer Motion variant that animates along the x axis (slide-in/out,
 * drawers, tab indicators) should multiply its x offset by this so motion
 * always matches reading direction instead of assuming LTR.
 *
 * Returns +1 for LTR, -1 for RTL. Prefers the live document direction and
 * falls back to the app language.
 */
export function useMotionDirection(): 1 | -1 {
  const { isRtl } = useLanguage();
  if (typeof document !== "undefined") {
    const dir = document.documentElement.getAttribute("dir");
    if (dir === "rtl") return -1;
    if (dir === "ltr") return 1;
  }
  return isRtl ? -1 : 1;
}
