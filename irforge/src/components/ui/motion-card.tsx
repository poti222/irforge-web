import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { hoverLiftMotion } from "@/lib/motion-variants";

/**
 * W4: a Card with the shared hover-lift/tap spring — used on dashboard,
 * marketplace and plans cards. Plain Card is left untouched so static
 * contexts (dialogs, admin tables) aren't affected.
 */
export const MotionCard = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof Card>>(
  ({ className, ...props }, ref) => {
    const reduce = useReducedMotion();
    return (
      <motion.div className="h-full" {...(reduce ? {} : hoverLiftMotion)}>
        <Card ref={ref} className={cn("h-full", className)} {...props} />
      </motion.div>
    );
  }
);
MotionCard.displayName = "MotionCard";
