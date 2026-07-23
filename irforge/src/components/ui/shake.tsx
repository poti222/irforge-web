import { useEffect } from "react";
import { motion, useAnimation, useReducedMotion } from "framer-motion";

/**
 * W6: brief horizontal shake used to register form-validation errors instantly.
 * Increment `trigger` (e.g. an error counter) to play the shake once. Respects
 * prefers-reduced-motion (no movement).
 */
export function Shake({
  trigger,
  children,
  className,
}: {
  trigger: number;
  children: React.ReactNode;
  className?: string;
}) {
  const controls = useAnimation();
  const reduce = useReducedMotion();

  useEffect(() => {
    if (trigger > 0 && !reduce) {
      controls.start({ x: [0, -10, 10, -10, 0], transition: { duration: 0.3 } });
    }
  }, [trigger, reduce, controls]);

  return (
    <motion.div className={className} animate={controls}>
      {children}
    </motion.div>
  );
}
