import { Link } from "wouter";
import { PublicFooter } from "@/components/layout/public-footer";
import { Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/use-translation";
import { useSEO } from "@/hooks/use-seo";

/**
 * `/pricing` — the **public** plan overview.
 *
 * Distinct from `/plans`, which is the authenticated purchase flow and stays
 * private and `Disallow`ed in robots.txt. This page exists so plan information
 * is indexable at all; it does not expose the purchase flow.
 *
 * ── Why there are no numbers on this page ────────────────────────────────
 * `GET /api/plans` is behind `requireAuth` (see api-server/src/routes/plans.ts)
 * so it cannot be read at build time, and the prices themselves live in the
 * `plans` table and are edited by admins at runtime — there is no fixed price
 * in this repository to mirror into a constant.
 *
 * Publishing a number we cannot confirm would be worse than publishing none,
 * and a `Product`/`Offer` node whose price disagrees with the real one is a
 * structured-data violation. So this page describes the tiers qualitatively,
 * and `offers` stays omitted from the `SoftwareApplication` node exactly as
 * the header comment in `lib/structured-data.ts` instructs. See SEO.md for the
 * two-step change that turns numbers on once prices are fixed.
 */

/** Tier shape, described without prices. Order is cheapest-first. */
const TIER_KEYS = ["trial", "starter", "growth"] as const;

export default function Pricing() {
  const t = useT("pricing") as Record<string, any>;
  const seo = useT("seo") as Record<string, string>;

  useSEO({ title: seo.pricingTitle, description: seo.pricingDescription, route: "/pricing" });

  return (
    <>
      <div className="mx-auto max-w-4xl space-y-10 px-4 py-8">
        <nav aria-label={t.breadcrumbLabel} className="text-sm text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <li><Link href="/" className="hover:text-foreground">{seo.navHome}</Link></li>
            <li aria-hidden="true">/</li>
            <li className="text-foreground">{seo.navPricing}</li>
          </ol>
        </nav>

        <header className="space-y-3">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t.title}</h1>
          <p className="text-lg leading-relaxed text-muted-foreground">{t.intro}</p>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">{t.tiersTitle}</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {TIER_KEYS.map((key) => (
              <Card key={key} className="h-full">
                <CardContent className="space-y-3 p-5">
                  <h3 className="font-semibold">{t.tiers[key].name}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {t.tiers[key].description}
                  </p>
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    {(t.tiers[key].features as string[]).map((f) => (
                      <li key={f} className="flex gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
          {/* Stated plainly rather than hidden: the current figures live in the
              signed-in plans screen, and this page will not guess at them. */}
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {t.priceNote}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t.faqTitle}</h2>
          <div className="space-y-3">
            {(t.faq as { q: string; a: string }[]).map((entry) => (
              <details
                key={entry.q}
                className="group rounded-xl border border-border bg-card px-5 py-4"
              >
                <summary className="cursor-pointer list-none text-start font-semibold [&::-webkit-details-marker]:hidden">
                  <h3 className="text-base">{entry.q}</h3>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{entry.a}</p>
              </details>
            ))}
          </div>
        </section>

        <div className="flex flex-wrap gap-3">
          <Button asChild><Link href="/register">{t.cta}</Link></Button>
          <Button asChild variant="outline"><Link href="/learn">{t.learnLink}</Link></Button>
        </div>
      </div>
      <PublicFooter />
    </>
  );
}
