import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/layout/brand-home";
import { PaletteButton } from "@/components/layout/palette-button";
import { ThemeToggleButton } from "@/components/layout/theme-toggle-button";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { useAuth } from "@/contexts/AuthContext";
import { useT } from "@/hooks/use-translation";

/**
 * The floating "island" navigation from the homepage, for every other public
 * page (pricing, about, the learn hub and its articles). One component, so the
 * public site reads as one product. Links are root-relative: the router base
 * already carries the language prefix.
 */
export function PublicNav() {
  const { user, isLoading } = useAuth();
  const tr = useT("landing");
  const footerT = useT("footer");
  const seo = useT("seo") as Record<string, string>;

  return (
    <header className="sticky top-3 z-50 px-3 pt-3">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-2 rounded-full border border-border/70 bg-background/75 px-3 shadow-[0_10px_34px_-14px_hsl(var(--foreground)/0.3)] backdrop-blur-xl sm:px-4">
        <BrandLogo href="/" className="min-w-0 sm:gap-3" />
        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          <Button asChild variant="ghost" size="sm" className="hidden rounded-full sm:inline-flex">
            <Link href="/learn">{footerT.learnNav}</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="hidden rounded-full md:inline-flex">
            <Link href="/pricing">{seo.navPricing}</Link>
          </Button>
          <PaletteButton className="rounded-full" />
          <ThemeToggleButton className="rounded-full" />
          <LanguageSwitcher />
          {isLoading ? (
            <div className="h-8 w-[72px] animate-pulse rounded-full bg-muted" aria-hidden="true" />
          ) : user ? (
            <Button asChild size="sm" className="rounded-full">
              <Link href="/dashboard">{tr.dashboard}</Link>
            </Button>
          ) : (
            <Button asChild size="sm" className="rounded-full">
              <Link href="/login">{tr.signIn}</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
