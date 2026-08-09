import { Link } from "wouter";
import { motion } from "framer-motion";
import { Bot } from "lucide-react";

/**
 * The IrForge brand glyph. Single source of truth — the sidebar, the landing
 * nav and footer, the auth pages, the docs header, the support FAB, the error
 * boundary and the bot-language page all render THIS, so the mark can only
 * ever be changed in one place.
 *
 * The artwork is lucide's `Bot`: a clean, stroked, head-only robot. It
 * replaces the older hand-drawn full-body SVG, which read as muddy at 20px —
 * too many filled shapes (body, chest screen, feet) crammed into a badge that
 * is only ever seen small.
 *
 * Colour comes from `currentColor`, so the same component works as a dark
 * glyph on the orange badge AND as an orange glyph on a light surface.
 */
export function OrangeRobot({ className }: { className?: string }) {
  return <Bot className={className} strokeWidth={2} aria-hidden="true" />;
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

/**
 * Two rendering scales for the lockup. `md` is the canonical size used by the
 * app sidebar header, the app shell header and the landing nav; `sm` exists
 * for the tighter, nested sidebars (bot workspace section nav, docs dashboard
 * preview) where a full-size badge next to 14px nav rows would visually shout.
 */
export type BrandLogoSize = "sm" | "md";

const BRAND_SIZES: Record<BrandLogoSize, { badge: string; glyph: string; label: string; gap: string }> = {
  sm: { badge: "size-7", glyph: "size-4", label: "text-base", gap: "gap-2" },
  md: { badge: "size-8", glyph: "size-5", label: "text-lg", gap: "gap-2" },
};

/**
 * The full brand lockup — badge + "IrForge" wordmark — used anywhere the
 * logo needs its label next to it (sidebar header, landing nav/footer, auth
 * pages). This is the single source of truth for that pairing so every
 * surface renders the exact same badge size, radius, and type scale.
 *
 * `href` defaults to "/" (home). Pass `href={null}` to render a static,
 * non-link lockup (rare — e.g. if it's already inside another link, or it's
 * part of a decorative product mockup that must not navigate anywhere).
 */
export function BrandLogo({
  className = "",
  href = "/",
  size = "md",
  "data-testid": dataTestId = "link-brand-logo",
}: {
  className?: string;
  href?: string | null;
  size?: BrandLogoSize;
  "data-testid"?: string;
}) {
  const s = BRAND_SIZES[size];

  const content = (
    <div className={`flex items-center ${s.gap} min-w-0 ${className}`}>
      <div
        className={`flex aspect-square ${s.badge} shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground`}
      >
        <OrangeRobot className={`${s.glyph} text-primary-foreground`} />
      </div>
      <span className={`truncate font-semibold ${s.label} tracking-tight text-foreground`}>
        IrForge
      </span>
    </div>
  );

  if (href === null) return content;

  return (
    <Link href={href} aria-label="IrForge" data-testid={dataTestId}>
      {content}
    </Link>
  );
}

/**
 * The standard sidebar header band: the brand lockup centred inside a fixed
 * row with a bottom hairline. Extracted so EVERY sidebar in the product — the
 * main app sidebar, the bot workspace section nav, and the dashboard preview
 * inside the docs page — renders the exact same header instead of each one
 * inventing its own (or having none at all).
 *
 * `href={null}` renders it inert, which is what decorative mockups want.
 */
export function SidebarBrandHeader({
  className = "",
  logoClassName = "",
  href = "/",
  size = "md",
  "data-testid": dataTestId = "sidebar-brand-header",
}: {
  className?: string;
  /** Extra classes for the lockup itself — the collapsed-icon sidebar uses
   *  this to hide the wordmark without losing the badge. */
  logoClassName?: string;
  href?: string | null;
  size?: BrandLogoSize;
  "data-testid"?: string;
}) {
  return (
    <div
      className={`flex h-16 shrink-0 items-center justify-center border-b border-sidebar-border px-4 py-0 ${className}`}
    >
      <div className="flex w-full items-center justify-center overflow-hidden">
        <BrandLogo href={href} size={size} className={logoClassName} data-testid={dataTestId} />
      </div>
    </div>
  );
}
