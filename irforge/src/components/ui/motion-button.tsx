import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { hoverLiftMotion } from "@/lib/motion-variants";

export interface MotionButtonProps extends ButtonProps {
  /** Extra classes for the wrapping div — pass "w-full" here when className also sets w-full. */
  wrapperClassName?: string;
}

/**
 * W4: a Button with the shared hover-lift/tap spring, for primary CTAs that
 * don't carry W1's glow (dashboard/marketplace "primary" actions).
 */
export const MotionButton = React.forwardRef<HTMLButtonElement, MotionButtonProps>(
  ({ className, wrapperClassName, children, ...props }, ref) => {
    const reduce = useReducedMotion();
    return (
      <motion.div
        className={cn("inline-block", wrapperClassName)}
        {...(reduce ? {} : hoverLiftMotion)}
      >
        <Button ref={ref} className={className} {...props}>
          {children}
        </Button>
      </motion.div>
    );
  }
);
MotionButton.displayName = "MotionButton";
