import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useLanguage } from "@/hooks/use-language";

/**
 * W9 / delight: animated hero version of the shared OrangeRobot mark. Rebuilt
 * with motion primitives so each part (body float, eye blink, antenna glow)
 * animates independently WITHOUT touching the static OrangeRobot used in the
 * header/sidebar. On mount it plays a one-time greeting — the head tilts
 * left/right twice and a "سلام! 👋" speech bubble pops in above the antenna,
 * then fades — so the first thing a visitor sees is the mascot saying hello.
 * Under prefers-reduced-motion all loops and the greeting are disabled and
 * the robot simply fades in once.
 */
export function HeroRobot({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const { lang } = useLanguage();
  const fa = lang === "fa";

  // One-shot greeting window on mount (skipped entirely under reduced-motion).
  const [greeting, setGreeting] = useState(!reduce);
  useEffect(() => {
    if (reduce) return;
    const t = setTimeout(() => setGreeting(false), 2800);
    return () => clearTimeout(t);
  }, [reduce]);

  const entrance = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.4 } }
    : {
        initial: { opacity: 0, scale: 0.8 },
        animate: { opacity: 1, scale: 1 },
        transition: { type: "spring" as const, stiffness: 260, damping: 20 },
      };

  // Body float animation removed per product decision — hero stays static, no bobbing.
  const float = {};

  const glow = reduce
    ? {}
    : { animate: { opacity: [0.6, 1, 0.6] }, transition: { duration: 2.5, ease: "easeInOut" as const, repeat: Infinity } };

  // Head tilt greeting — left/right, exactly twice, once on mount. Eyes are
  // part of this group so they move with the head, but get no animation of
  // their own (no blink).
  const headTilt = reduce
    ? {}
    : {
        style: { transformOrigin: "24px 22px" },
        animate: greeting ? { rotate: [0, -6, 6, -6, 6, 0] } : { rotate: 0 },
        transition: greeting
          ? { duration: 1.8, delay: 0.4, ease: "easeInOut" as const }
          : { duration: 0.3 },
      };

  return (
    <div className={`relative inline-block pt-6 ${className ?? ""}`}>
      {/* Greeting speech bubble — one-shot, centred right above the antenna.
          Anchored at top-6 (not top-0): the wrapper reserves that 6-unit
          strip above the SVG itself, so the bubble sits snug against the
          antenna tip instead of floating disconnected above the whole mark. */}
      <AnimatePresence>
        {greeting && (
          <motion.div
            key="greet"
            initial={{ opacity: 0, y: 8, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.25 } }}
            transition={{ type: "spring", stiffness: 320, damping: 18, delay: 0.55 }}
            className="pointer-events-none absolute left-1/2 top-6 z-10 -translate-x-1/2 -translate-y-1/2"
          >
            <div className="relative whitespace-nowrap rounded-2xl border bg-card px-3 py-1.5 text-sm font-bold text-card-foreground shadow-lg">
              {fa ? "سلام! 👋" : "Hi! 👋"}
              <span className="absolute -bottom-1 left-1/2 size-2.5 -translate-x-1/2 rotate-45 border-b border-e bg-card" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.svg
        viewBox="0 0 48 52"
        xmlns="http://www.w3.org/2000/svg"
        className="h-auto w-full"
        fill="currentColor"
        role="img"
        aria-label="IrForge robot mascot"
        whileHover={reduce ? undefined : { rotate: [0, -4, 4, 0], transition: { duration: 0.6 } }}
        {...entrance}
      >
        <motion.g {...float}>
          {/* head group — antenna, ears, head, eyes, smile all tilt together, twice, on mount */}
          <motion.g {...headTilt}>
            {/* antenna + soft glow halo */}
            {!reduce && (
              <motion.circle
                cx="24" cy="6" r="5.5" fill="currentColor"
                style={{ transformBox: "fill-box", transformOrigin: "center" }}
                animate={{ opacity: [0.18, 0.4, 0.18], scale: [0.9, 1.12, 0.9] }}
                transition={{ duration: 2.6, ease: "easeInOut", repeat: Infinity }}
              />
            )}
            <line x1="24" y1="6.6" x2="24" y2="12" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            <motion.circle cx="24" cy="6" r="2.6" style={{ filter: "drop-shadow(0 0 4px currentColor)" }} {...glow} />
            {/* head */}
            <rect x="9.5" y="11.5" width="29" height="20" rx="9" />
            {/* eyes — untouched, no blink or separate animation */}
            <ellipse cx="18.6" cy="21" rx="3.6" ry="3.8" fill="#fff" />
            <ellipse cx="29.4" cy="21" rx="3.6" ry="3.8" fill="#fff" />
            <circle cx="18.6" cy="21.4" r="1.9" fill="hsl(0 0% 8%)" />
            <circle cx="29.4" cy="21.4" r="1.9" fill="hsl(0 0% 8%)" />
            <circle cx="19.5" cy="20.3" r="0.75" fill="#fff" />
            <circle cx="30.3" cy="20.3" r="0.75" fill="#fff" />
            {/* smile */}
            <path d="M20.4 26.2 Q24 28.9 27.6 26.2" fill="none" stroke="hsl(0 0% 8%)" strokeWidth="1.7" strokeLinecap="round" opacity="0.5" />
            {/* ears */}
            <rect x="6" y="17" width="4" height="9" rx="2" />
            <rect x="38" y="17" width="4" height="9" rx="2" />
          </motion.g>
          {/* body */}
          <rect x="12.5" y="33.5" width="23" height="13.5" rx="6" />
          {/* chest screen */}
          <rect x="17.5" y="36.6" width="13" height="7" rx="3" fill="hsl(0 0% 8%)" opacity="0.22" />
          <circle cx="21" cy="40.1" r="1.05" fill="#fff" opacity="0.55" />
          <circle cx="27" cy="40.1" r="1.05" fill="#fff" opacity="0.55" />
          {/* feet */}
          <rect x="16" y="47.4" width="6.5" height="3" rx="1.5" />
          <rect x="25.5" y="47.4" width="6.5" height="3" rx="1.5" />
        </motion.g>
      </motion.svg>
    </div>
  );
}
