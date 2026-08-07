import { useEffect, useState } from "react";

/**
 * Landing-local viewport probe. Mirrors Tailwind's `md` breakpoint (768px), so
 * "mobile" here means exactly the same thing as `md:` not applying.
 *
 * Why a separate hook instead of `@/hooks/use-mobile`: that one starts as
 * `undefined` (→ `false`) until its effect runs, which would make the landing
 * page mount the desktop scroll-linked branch for one frame on a phone. Here
 * the initial value is read synchronously from `matchMedia`, guarded by a
 * `typeof window` check so a non-browser render (SSR/prerender) gets a stable
 * `false` on both sides and can't cause a hydration mismatch.
 */
const MOBILE_QUERY = "(max-width: 767px)";

function readMatches(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(MOBILE_QUERY).matches;
}

export function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(readMatches);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    // re-sync once on mount in case the viewport changed between render and effect
    setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
