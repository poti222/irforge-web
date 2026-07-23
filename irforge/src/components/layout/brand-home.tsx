import { Link } from "wouter";
import { motion } from "framer-motion";

/**
 * The IrForge orange-robot mark. Shared by the landing page, the sidebar,
 * and the BrandHomeButton below so there's a single source of truth for
 * the logo artwork instead of copy-pasted inline SVGs.
 *
 * Single-colour glyph: the body is `currentColor` (so it inherits
 * text-primary / text-primary-foreground from its container) while the
 * eyes are white with a dark pupil — that keeps the face readable both as a
 * near-black glyph on the orange badge AND as an orange glyph on light.
 */
export function OrangeRobot({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" className={className} fill="currentColor">
      {/* antenna */}
      <line x1="24" y1="3.6" x2="24" y2="9" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="24" cy="3" r="2.6" />
      {/* head — rounded dome */}
      <rect x="9.5" y="8.5" width="29" height="20" rx="9" />
      {/* eyes — white with dark pupil + catchlight */}
      <ellipse cx="18.6" cy="18" rx="3.6" ry="3.8" fill="#fff" />
      <ellipse cx="29.4" cy="18" rx="3.6" ry="3.8" fill="#fff" />
      <circle cx="18.6" cy="18.4" r="1.9" fill="hsl(0 0% 8%)" />
      <circle cx="29.4" cy="18.4" r="1.9" fill="hsl(0 0% 8%)" />
      <circle cx="19.5" cy="17.3" r="0.75" fill="#fff" />
      <circle cx="30.3" cy="17.3" r="0.75" fill="#fff" />
      {/* smile */}
      <path d="M20.4 23.2 Q24 25.9 27.6 23.2" fill="none" stroke="hsl(0 0% 8%)" strokeWidth="1.7" strokeLinecap="round" opacity="0.5" />
      {/* ears */}
      <rect x="6" y="14" width="4" height="9" rx="2" />
      <rect x="38" y="14" width="4" height="9" rx="2" />
      {/* body */}
      <rect x="12.5" y="30.5" width="23" height="13.5" rx="6" />
      {/* chest screen */}
      <rect x="17.5" y="33.6" width="13" height="7" rx="3" fill="hsl(0 0% 8%)" opacity="0.22" />
      <circle cx="21" cy="37.1" r="1.05" fill="#fff" opacity="0.55" />
      <circle cx="27" cy="37.1" r="1.05" fill="#fff" opacity="0.55" />
      {/* feet */}
      <rect x="16" y="44.4" width="6.5" height="3" rx="1.5" />
      <rect x="25.5" y="44.4" width="6.5" height="3" rx="1.5" />
    </svg>
  );
}

/**
 * Clickable brand mark that always returns the user to the landing page ("/").
 * Render this on every page EXCEPT the landing page itself, per design spec —
 * it gives people a consistent, obvious way back to the home screen.
 */
export function BrandHomeButton({ className = "" }: { className?: string }) {
  return (
    <Link href="/" aria-label="Back to homepage" data-testid="link-brand-home">
      <motion.div
        whileHover={{ scale: 1.08, rotate: -4 }}
        whileTap={{ scale: 0.92 }}
        transition={{ type: "spring", stiffness: 400, damping: 17 }}
        className={`flex aspect-square size-9 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm cursor-pointer ${className}`}
      >
        <OrangeRobot className="size-5 text-primary-foreground" />
      </motion.div>
    </Link>
  );
}
