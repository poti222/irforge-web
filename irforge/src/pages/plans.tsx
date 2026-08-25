/**
 * pages/plans.tsx — IRFORGE_PROMPT_V3 Phase 34.
 * ─────────────────────────────────────────────────────────────────────────────
 * The authenticated purchase flow `/pricing`'s own header comment has
 * described for a while ("Distinct from `/plans`, which is the authenticated
 * purchase flow") but that never existed — `POST /plans/subscribe` took no
 * payment and no page called it. This is that page.
 *
 * One list, one button per plan whose label/effect depends on the
 * relationship to the account's current plan (`lib/planChange.ts` on the
 * server decides the actual charge/date math; this only has to guess the
 * right label so the button doesn't lie before the request even goes out).
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useListPlans,
  useGetCurrentPlan,
  useSubscribeToPlan,
  getGetCurrentPlanQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import type { Plan } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";
import { formatToman } from "@/lib/format";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";

type Relation = "current" | "renew" | "upgrade" | "downgrade" | "subscribe";

function relationOf(plan: Plan, plans: Plan[] | undefined, current: { planId: string; status: string } | undefined): Relation {
  if (!current) return "subscribe";
  if (plan.id === current.planId) {
    return current.status === "active" ? "current" : "renew";
  }
  if (current.status !== "active") {
    return "subscribe";
  }
  const currentPrice = plans?.find((p) => p.id === current.planId)?.price ?? 0;
  return plan.price > currentPrice ? "upgrade" : "downgrade";
}

export default function Plans() {
  const t = useT("plans");
  const { lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);

  usePrivatePageTitle(t.title);

  const { data: plans, isLoading: plansLoading } = useListPlans();
  const { data: current, isLoading: currentLoading } = useGetCurrentPlan();
  const { data: wallet } = useQuery({
    queryKey: ["wallet"],
    queryFn: () => customFetch<{ balance: number }>("/api/wallet"),
  });
  const subscribe = useSubscribeToPlan();

  async function choosePlan(plan: Plan, relation: Relation) {
    if (relation === "current" || busyPlanId) return;
    setBusyPlanId(plan.id);
    try {
      const result = await subscribe.mutateAsync({ data: { planId: plan.id } });
      queryClient.invalidateQueries({ queryKey: getGetCurrentPlanQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
      const successKey =
        result.action === "renew" ? "successRenew"
        : result.action === "upgrade" ? "successUpgrade"
        : result.action === "downgrade" ? "successDowngrade"
        : "successSubscribe";
      toast({ title: t[successKey].replace("{plan}", plan.name) });
    } catch (err: any) {
      if (err?.data?.code === "insufficient") {
        toast({ variant: "destructive", title: t.insufficientTitle, description: t.insufficientDesc });
        setLocation("/wallet");
        return;
      }
      toast({ variant: "destructive", title: t.errorTitle, description: err?.data?.error ?? err?.message });
    } finally {
      setBusyPlanId(null);
    }
  }

  const ctaLabel: Record<Relation, string> = {
    current: t.ctaCurrent,
    renew: t.ctaRenew,
    upgrade: t.ctaUpgrade,
    downgrade: t.ctaDowngrade,
    subscribe: t.ctaSubscribe,
  };
  const intervalSuffix = (interval: string) => (interval === "yearly" ? t.perYear : t.perMonth);

  const loading = plansLoading || currentLoading;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t.title}</h1>
          <p className="text-muted-foreground">{t.subtitle}</p>
        </div>
        {wallet && (
          <p className="text-sm text-muted-foreground">{t.walletBalance.replace("{amount}", formatToman(wallet.balance, lang))}</p>
        )}
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-64 animate-pulse rounded-xl bg-muted" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(plans ?? []).map((plan) => {
            const relation = relationOf(plan, plans, current);
            const busy = busyPlanId === plan.id;
            return (
              <Card key={plan.id} className={plan.popular ? "border-primary/50 shadow-sm" : undefined}>
                <CardHeader className="space-y-2 pb-3">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-lg">{plan.name}</CardTitle>
                    {plan.popular && (
                      <Badge variant="default" className="gap-1"><Sparkles className="size-3" /> {t.popularBadge}</Badge>
                    )}
                    {relation === "current" && <Badge variant="secondary">{t.currentBadge}</Badge>}
                  </div>
                  <CardDescription className="text-2xl font-bold text-foreground">
                    {plan.price > 0 ? (
                      <>{formatToman(plan.price, lang)} <span className="text-sm font-normal text-muted-foreground">{intervalSuffix(plan.interval)}</span></>
                    ) : t.free}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full border px-2 py-0.5">{t.maxBots.replace("{n}", String(plan.maxBots))}</span>
                    <span className="rounded-full border px-2 py-0.5">{t.maxPlugins.replace("{n}", String(plan.maxPlugins))}</span>
                  </div>
                  {plan.features.length > 0 && (
                    <ul className="space-y-1.5 text-sm">
                      {plan.features.map((f) => (
                        <li key={f} className="flex gap-2">
                          <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
                <CardFooter>
                  <Button
                    className="w-full"
                    variant={relation === "current" ? "outline" : "default"}
                    disabled={relation === "current" || busy}
                    onClick={() => choosePlan(plan, relation)}
                  >
                    {busy && <Loader2 className="me-2 size-4 animate-spin" />}
                    {ctaLabel[relation]}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
