import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useT } from "@/hooks/use-translation";

/**
 * The big "build your own bot" button for content pages.
 *
 * A guide that persuades and then offers no way to act on it wastes the visit,
 * so every article carries this twice: right under the headline — where it is
 * on screen before any scrolling — and again at the end of the page.
 *
 * Signed-out visitors (and the prerendered HTML, which is always rendered signed
 * out) get `/register`; a signed-in visitor goes straight to the bot store.
 * Root-relative hrefs: the router `base` adds the language prefix.
 */
export function BuildBotCta({ className = "", showNote = true }: { className?: string; showNote?: boolean }) {
  const t = useT("learn");
  const { user } = useAuth();

  return (
    <div
      className={`flex flex-col items-stretch gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5 ${className}`}
    >
      {showNote && <p className="text-sm leading-relaxed text-muted-foreground sm:max-w-xs">{t.topCtaNote}</p>}
      <Button size="lg" className="h-12 shrink-0 px-8 text-base font-bold" asChild>
        <Link href={user ? "/products" : "/register"} data-testid="link-build-your-bot">
          {t.topCtaButton} <ChevronRight className="ms-2 size-4 rtl-flip" aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}
