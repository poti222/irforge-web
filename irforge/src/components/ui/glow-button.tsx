import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { hoverLiftMotion } from "@/lib/motion-variants";

/**
 * W1: a hover-triggered rotating gradient border, reserved for the 3-4
 * highest-value CTAs (register/plans-upgrade/bot-start) — not applied
 * everywhere, since constant motion on every button reads as noisy.
 * Under prefers-reduced-motion the glow still appears on hover but the
 * gradient stays static (no rotation).
 *
 * Also carries W4's shared hover-lift/tap spring — the two effects trigger
 * at the same moment here but are independent, matching the plan's note
 * that W1 and W4 can coexist on the same button.
 */
export interface GlowButtonProps extends ButtonProps {
  /** Extra classes for the wrapping div — pass "w-full" here when className also sets w-full. */
  wrapperClassName?: string;
}

export const GlowButton = React.forwardRef<HTMLButtonElement, GlowButtonProps>(
  ({ className, wrapperClassName, children, ...props }, ref) => {
    const [hovered, setHovered] = React.useState(false);
    const reduce = useReducedMotion();

    return (
      <div
        className={cn("group relative inline-block rounded-md", wrapperClassName)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/*
          The gradient's ANGLE spins via the registered --glow-angle custom
          property (index.css), not a transform:rotate() on this element —
          rotating the element itself would swing a wide/short button's
          bounding box far outside its own footprint on non-square buttons.
        */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute -inset-[2px] rounded-md blur-[3px] transition-opacity duration-300",
            hovered ? "opacity-100" : "opacity-0",
            !reduce && hovered && "[animation:glow-spin_2.5s_linear_infinite]"
          )}
          style={{
            background:
              "conic-gradient(from var(--glow-angle, 0deg), hsl(var(--primary)) 0%, transparent 25%, hsl(var(--primary)) 50%, transparent 75%, hsl(var(--primary)) 100%)",
          }}
        />
        <motion.div className="relative w-full" {...(reduce ? {} : hoverLiftMotion)}>
          <Button ref={ref} className={className} {...props}>
            {children}
          </Button>
        </motion.div>
      </div>
    );
  }
);
GlowButton.displayName = "GlowButton";
