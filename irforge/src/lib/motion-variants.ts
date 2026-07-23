/**
 * W4: shared hover/tap spring used by every primary button and card so the
 * numbers stay consistent instead of each component inventing its own.
 * Small scale/lift on hover, slight compress on tap, spring (not linear
 * easing, which reads stiffer/cheaper for this kind of micro-interaction).
 */
export const hoverLiftMotion = {
  whileHover: { scale: 1.02, y: -2 },
  whileTap: { scale: 0.98 },
  transition: { type: "spring" as const, stiffness: 350, damping: 20 },
};
