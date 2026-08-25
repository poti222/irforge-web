import { Link } from "wouter";
import { PublicFooter } from "@/components/layout/public-footer";
import { Check, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useListPlans } from "@workspace/api-client-react";
import type { Plan } from "@workspace/api-client-react";
import { useT } from "@/hooks/use-translation";
import { useSEO } from "@/hooks/use-seo";
import { useLanguage } from "@/hooks/use-language";
import { useCurrency } from "@/hooks/use-currency";
import { formatToman, formatConvertedAmount } from "@/lib/format";

/**
 * `/pricing` — the **public** subscription-plan overview.
 *
 * Distinct from `/plans`, which is the authenticated purchase flow and stays
 * private and `Disallow`ed in robots.txt. This page exists so plan information
 * is indexable at all; it does not expose the purchase flow.
 *
 * IRFORGE_PROMPT_V3 Phase 44 — this used to describe three tiers ("Trial",
 * "Starter", "Growth") purely qualitatively, with no prices at all, because
 * `GET /api/plans` was `requireAuth`-gated. Two problems with that, not one:
 * the missing numbers, and those three tier names were never real — the
 * actual `plans` table (edited from the admin panel, PlansManager.tsx) has
 * never contained a plan named any of them. `GET /api/plans` is now public
 * (it returns no per-user data — name/price/features/limits only), so this
 * renders the real, current plans instead of describing fictional ones.
 *
 * `offers` still stays out of the `SoftwareApplication` structured-data node
 * (see lib/structured-data.ts) even though a price is visible here now: this
 * page fetches plans client-side, but the structured data is baked into the
 * prerendered HTML at build time — embedding a price there would drift from
 * the live, admin-editable one the moment it changes without a redeploy,
 * which is exactly the "schema disagrees with the real number" problem that
 * node's own comment already warns against.
 */

function byPriceAscending(a: Plan, b: Plan) {
  return a.price - b.price;
}

export default function Pricing() {
  const t = useT("pricing") as Record<string, any>;
  const tPlans = useT("plans");
  const seo = useT("seo") as Record<string, string>;
  const { lang } = useLanguage();
  const { activeRate } = useCurrency();

  useSEO({ title: seo.pricingTitle, description: seo.pricingDescription, route: "/pricing" });

  const { data: plans, isLoading: plansLoading } = useListPlans();
  const sortedPlans = [...(plans ?? [])].sort(byPriceAscending);

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
          {plansLoading ? (
            <div className="grid gap-4 sm:grid-cols-3">
              {[1, 2, 3].map((i) => <div key={i} className="h-64 animate-pulse rounded-xl bg-muted" />)}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              {sortedPlans.map((plan) => (
                <Card key={plan.id} className={plan.popular ? "h-full border-primary/50 shadow-sm" : "h-full"}>
                  <CardHeader className="space-y-2 pb-3">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg">{plan.name}</CardTitle>
                      {plan.popular && (
                        <Badge variant="default" className="gap-1"><Sparkles className="size-3" /> {tPlans.popularBadge}</Badge>
                      )}
                    </div>
                    <CardDescription className="text-2xl font-bold text-foreground">
                      {plan.price > 0 ? (
                        <>{formatToman(plan.price, lang)} <span className="text-sm font-normal text-muted-foreground">{plan.interval === "yearly" ? tPlans.perYear : tPlans.perMonth}</span></>
                      ) : tPlans.free}
                    </CardDescription>
                    {plan.price > 0 && activeRate && (
                      <p className="text-xs text-muted-foreground">{formatConvertedAmount(plan.price, activeRate, lang)}</p>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span className="rounded-full border px-2 py-0.5">{tPlans.maxBots.replace("{n}", String(plan.maxBots))}</span>
                      <span className="rounded-full border px-2 py-0.5">{tPlans.maxPlugins.replace("{n}", String(plan.maxPlugins))}</span>
                    </div>
                    {plan.features.length > 0 && (
                      <ul className="space-y-1.5 text-sm text-muted-foreground">
                        {plan.features.map((f) => (
                          <li key={f} className="flex gap-2">
                            <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
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
