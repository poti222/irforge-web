import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { useT } from "@/hooks/use-translation";
import { cn } from "@/lib/utils";

/**
 * back-home-button.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Sits on the opposite side of `PublicPageControls` (theme/language) on
 * every stand-alone auth page — login, register, forgot/reset-password —
 * none of which had any way back to the marketing site short of the
 * browser's own back button. Same size/shape language as
 * `ThemeToggleButton` (size-9, rounded-md, border) so the two feel like one
 * matched header-control pair rather than two different UI languages.
 *
 * `ArrowRight` (not `ArrowLeft`) because in this app's RTL-first layout an
 * icon meaning "back" visually points toward the *start* of the line, which
 * in Persian is the right; `cn`'s rtl:rotate-180 mirrors it back to a
 * left-pointing arrow for LTR locales instead of shipping two icons.
 */
export function BackHomeButton({ className }: { className?: string }) {
  const t = useT("auth") as Record<string, string>;

  return (
    <Link
      href="/"
      aria-label={t.backToHome ?? "Back to home"}
      className={cn(
        "group inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3",
        "text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary",
        className,
      )}
    >
      <ArrowRight className="size-4 rtl:rotate-180 transition-transform group-hover:-translate-x-0.5 rtl:group-hover:translate-x-0.5" aria-hidden="true" />
      <span className="hidden sm:inline">{t.backToHome ?? "Back to home"}</span>
    </Link>
  );
}
