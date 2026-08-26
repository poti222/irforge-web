import { ThemeToggleButton } from "@/components/layout/theme-toggle-button";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { cn } from "@/lib/utils";

/**
 * public-page-controls.tsx — IRFORGE_PROMPT_V3 Phase 45 (design foundations).
 * ─────────────────────────────────────────────────────────────────────────────
 * The landing page has always paired `ThemeToggleButton` + `LanguageSwitcher`
 * in its header; every OTHER public marketing page (`/pricing`, `/learn`,
 * every `/learn/*` article) never gained that pair at all — each was just a
 * breadcrumb and a content header, with no way to switch language or theme
 * short of navigating back to `/`. `/docs` had the same gap until
 * IRFORGE_PROMPT_V3 Phase 44 fixed it directly in that page's own custom
 * header; this is the shared version so the fix doesn't need re-deriving
 * per page — drop it beside each page's breadcrumb `<nav>`.
 */
export function PublicPageControls({ className }: { className?: string }) {
  return (
    <div className={cn("flex shrink-0 items-center gap-1.5", className)}>
      <ThemeToggleButton className="rounded-full" />
      <LanguageSwitcher />
    </div>
  );
}
