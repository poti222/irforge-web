import { Link } from "wouter";
import { useT } from "@/hooks/use-translation";
import { useSEO } from "@/hooks/use-seo";

/**
 * `/pricing` — the **public** plan overview.
 *
 * Distinct from `/plans`, which is the authenticated purchase flow and stays
 * private and `Disallow`ed. This page exists so plan information is indexable
 * at all; the purchase flow is not exposed by it.
 *
 * Phase 3 registers the route and the shell. Phase 8 fills in the tiers.
 */
export default function Pricing() {
  const t = useT("pricing");
  const seo = useT("seo") as Record<string, string>;

  useSEO({ title: seo.pricingTitle, description: seo.pricingDescription, route: "/pricing" });

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t.title}</h1>
        <p className="text-lg leading-relaxed text-muted-foreground">{t.intro}</p>
      </header>

      <p className="text-sm text-muted-foreground">
        <Link href="/learn" className="text-primary underline-offset-4 hover:underline">
          {t.learnLink}
        </Link>
      </p>
    </div>
  );
}
