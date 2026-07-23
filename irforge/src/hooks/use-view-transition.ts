import { useReducedMotion } from "framer-motion";

type ViewTransitionLike = {
  ready: Promise<void>;
  finished: Promise<void>;
};

/**
 * Shared helper for W2 (theme corner sweep) and W3 (language fade+scale):
 * runs `update` inside the View Transitions API when available, and lets the
 * caller drive a custom Web Animations API animation on the transition
 * pseudo-elements once the DOM snapshot is ready. Falls back to an instant,
 * synchronous `update()` — no error, no animation — when the browser lacks
 * support (older Safari/Firefox) or the user prefers reduced motion.
 */
export function useRunViewTransition() {
  const reduce = useReducedMotion();

  return function runViewTransition(
    update: () => void,
    onReady?: (transition: ViewTransitionLike) => void
  ) {
    const supported =
      typeof document !== "undefined" && typeof (document as any).startViewTransition === "function";

    if (reduce || !supported) {
      update();
      return;
    }

    const transition = (document as any).startViewTransition(update) as ViewTransitionLike;
    if (onReady) {
      transition.ready.then(() => onReady(transition)).catch(() => {});
    }
  };
}
