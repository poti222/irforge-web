import { useState, type ReactNode } from "react";
import { motion, type Variants } from "framer-motion";

/**
 * Shared reveal primitives for the landing page.
 *
 * Rules baked in here (see the redesign brief):
 *  - only `transform` + `opacity` animate, never layout properties;
 *  - `will-change: transform` is set while an element animates and dropped the
 *    moment it settles, so a long page doesn't keep dozens of promoted layers
 *    alive;
 *  - every scroll reveal is `once: true`, so scrolling back up doesn't replay.
 */

export const VIEWPORT_ONCE = { once: true, amount: 0.2 } as const;

export function revealContainer(stagger: number): Variants {
  return {
    hidden: {},
    show: { transition: { staggerChildren: stagger, delayChildren: stagger > 0 ? 0.05 : 0 } },
  };
}

export function revealItem(reduce: boolean): Variants {
  return reduce
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.3 } } }
    : {
        hidden: { opacity: 0, y: 18 },
        show: { opacity: 1, y: 0, transition: { duration: 0.42, ease: "easeOut" } },
      };
}

/**
 * A child of a `variants`-driven container. Inherits the parent's animation
 * state (so staggering works) and cleans up its own `will-change` on settle.
 */
export function RevealItem({
  variants,
  className,
  children,
}: {
  variants: Variants;
  className?: string;
  children: ReactNode;
}) {
  const [settled, setSettled] = useState(false);
  return (
    <motion.div
      variants={variants}
      className={className}
      style={{ willChange: settled ? "auto" : "transform, opacity" }}
      onAnimationComplete={() => setSettled(true)}
    >
      {children}
    </motion.div>
  );
}
