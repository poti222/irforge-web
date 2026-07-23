import { Link, useLocation } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import { OrangeRobot } from "@/components/layout/brand-home";
import { useLanguage } from "@/hooks/use-language";

/**
 * A floating support robot pinned to the corner of every dashboard page.
 * It breathes gently to draw a little attention, reveals a "Need help?" pill
 * on hover, and links to the support page. Hidden on the support page itself
 * and fully still under prefers-reduced-motion.
 */
export function SupportFab() {
  const [location] = useLocation();
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const reduce = useReducedMotion();

  if (location === "/support") return null;

  return (
    <Link
      href="/support"
      aria-label={fa ? "پشتیبانی" : "Support"}
      data-testid="fab-support"
      // Sit opposite the sidebar so it never overlaps it: sidebar is on the
      // right in RTL (→ FAB left) and on the left in LTR (→ FAB right).
      className={`group fixed bottom-6 z-40 outline-none ${fa ? "left-6" : "right-6"}`}
    >
      <motion.div
        className="relative flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl ring-1 ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.94 }}
        animate={reduce ? {} : { y: [0, -3, 0] }}
        transition={reduce ? {} : { duration: 2.4, ease: "easeInOut", repeat: Infinity }}
      >
        {/* hover label — anchored on the side facing the viewport center, not
            just "right-full": the FAB itself flips to left-6 in fa/ar, so a
            fixed right-full would push the label further off the left edge
            of the screen (real overflow on mobile RTL) instead of toward it. */}
        <span
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border bg-card px-3 py-1.5 text-sm font-medium text-card-foreground opacity-0 shadow-lg transition-opacity duration-300 group-hover:opacity-100 ${
            fa ? "left-full ml-3" : "right-full mr-3"
          }`}
        >
          {fa ? "کمک می‌خوای؟" : "Need help?"}
        </span>
        {!reduce && <span className="absolute inset-0 rounded-full bg-primary/30 animate-ping" />}
        <OrangeRobot className="relative size-8" />
      </motion.div>
    </Link>
  );
}
