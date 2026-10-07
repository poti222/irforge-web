import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { BrandLogo } from "@/components/layout/brand-home";
import { BackHomeButton } from "@/components/layout/back-home-button";
import { PublicPageControls } from "@/components/layout/public-page-controls";
import { Embers } from "@/components/landing/forge/Embers";
import { useT } from "@/hooks/use-translation";

/**
 * Split-screen frame for every sign-in style page: a steel panel with the
 * product promise on one side (hidden below `lg`, where the form takes the
 * whole screen), the form on the other. The form side keeps the page-level
 * controls (back home, palette/theme/language) exactly where they were.
 */
export function AuthShell({ children, className = "max-w-md" }: { children: ReactNode; className?: string }) {
  const tr = useT("landing");
  const points = tr.forge.capabilities.slice(0, 5);

  return (
    <div className="grid min-h-[calc(100dvh-5.5rem)] lg:grid-cols-[1.05fr_1fr]">
      <aside className="forge-dark dark relative isolate hidden flex-col justify-between overflow-hidden bg-[hsl(222_16%_6%)] p-12 text-foreground lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(600px 420px at 100% 0%, hsl(var(--primary) / .32), transparent 70%), radial-gradient(520px 380px at 0% 100%, hsl(var(--primary) / .16), transparent 70%)",
          }}
        />
        <Embers count={22} className="-z-10" />
        <BrandLogo href="/" data-testid="auth-brand" />
        <div className="space-y-6">
          <h2 className="max-w-md text-4xl font-bold leading-[1.25]">{tr.tagline}</h2>
          <p className="max-w-md leading-relaxed text-muted-foreground">{tr.taglineSub}</p>
          <ul className="space-y-2.5 pt-2">
            {points.map((p) => (
              <li key={p} className="flex items-center gap-3 text-sm">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <Check className="size-3" />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">© IrForge</p>
      </aside>

      <main className="relative flex items-center justify-center bg-background px-4 pb-14 pt-24 lg:py-14">
        <BackHomeButton className="absolute start-4 top-4 z-10" />
        <PublicPageControls className="absolute end-4 top-4 z-10" />
        <div className={`w-full space-y-6 ${className}`}>
          <div className="flex justify-center lg:hidden">
            <BrandLogo href="/" />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
