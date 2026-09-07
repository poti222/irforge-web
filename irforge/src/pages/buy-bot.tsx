import { useState, useMemo } from "react";
import { Link } from "wouter";
import {
  useListPlans,
  useGetCurrentPlan,
  useSubscribeToPlan,
  getGetCurrentPlanQueryKey,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import type { Plan } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { MotionCard } from "@/components/ui/motion-card";
import { Button } from "@/components/ui/button";
import { GlowButton } from "@/components/ui/glow-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Check, Settings2, ArrowLeft, ArrowRight, Gift, Loader2, Cpu, MemoryStick, Users, PackageOpen } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import type { Lang } from "@/lib/i18n";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { formatToman } from "@/lib/format";
import { useListProductCategories, useListProducts, type Product, type ProductCategory } from "@/hooks/use-products";
import { productIcon } from "@/lib/product-icons";
import { pluginName, pluginDescription } from "@/lib/plugin-text";
import { TrialDialog } from "@/components/bots/TrialDialog";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";

/**
 * IRFORGE_PRODUCTS_SECTION_PROMPT Phase 3 — this page used to be "Buy Bot"
 * with a single hardcoded Standard/Pro/Custom grid (`bot-tiers.ts`). It's now
 * "Products": six categories, each reading from `GET /api/products` (Phase
 * 2's real, database-backed catalog) instead of a frontend constant.
 *
 * The bot category keeps the exact same tier-card UI as before — only its
 * data source changed, from `BOT_TIERS` to `useListProducts("bot")` — which
 * is the point of this phase: `buy-bot-detail.tsx`'s checkout and this page's
 * display now read the *same* `products` row `pluginPricing.ts` charges
 * from, so a display/charge mismatch (Phase 1/2's own finding) is no longer
 * possible for the one category that actually charges money today.
 *
 * The other five categories are intentionally left empty rather than seeded
 * with invented placeholder content — Phase 4's admin panel is the tool to
 * populate them for real; a fabricated "sample" product would just be
 * something an admin has to notice and delete later.
 *
 * Custom package: unchanged, still a disabled placeholder card sourced from
 * `botTiers` i18n text — deliberately out of scope for this migration (see
 * PROGRESS.md's Phase 1 entry).
 */
export default function BuyBot() {
  usePrivatePageTitle(useT("pageTitles").products);
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const t = useT("buyBot");
  const tp = useT("products");
  // متن پکیج‌های بات از فایل‌های ترجمه، نه از products.metadata — همان
  // قاعده‌ای که پیش از این فاز هم برقرار بود (فقط منبعِ قیمت/منابع عوض شد).
  const tt = useT("botTiers");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const ArrowIcon = fa ? ArrowLeft : ArrowRight;
  const [trialOpen, setTrialOpen] = useState(false);
  const hasUsedTrial = Boolean(user?.hasUsedTrial);

  const { data: categories, isLoading: categoriesLoading } = useListProductCategories();
  const sortedCategories = useMemo(
    () => [...(categories ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [categories],
  );
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const currentTab = activeCategory ?? sortedCategories[0]?.id ?? "bot";

  const { data: plans, isLoading: plansLoading } = useListPlans();
  const { data: currentPlan } = useGetCurrentPlan();
  const subscribe = useSubscribeToPlan();
  const [pendingPlan, setPendingPlan] = useState<Plan | null>(null);

  const currentPlanPrice = plans?.find((p) => p.id === currentPlan?.planId)?.price ?? 0;
  const busyPlanId = subscribe.isPending ? subscribe.variables?.data.planId : null;

  function requestUpgrade(plan: Plan) {
    // A cheaper/free switch applies straight away; a paid upgrade confirms first.
    if (plan.price > currentPlanPrice) setPendingPlan(plan);
    else applyPlan(plan);
  }

  function applyPlan(plan: Plan) {
    subscribe.mutate(
      { data: { planId: plan.id } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCurrentPlanQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          toast({ title: t.planUpdated, description: plan.name });
          setPendingPlan(null);
        },
        onError: (err: any) => {
          toast({ variant: "destructive", title: t.planUpdateFailed, description: err?.message });
          setPendingPlan(null);
        },
      }
    );
  }

  /** متن ترجمه‌شده‌ی یک پکیجِ بات (قیمت و منابع از products.metadata می‌آید، نه از این‌جا). */
  function tierText(productId: string) {
    switch (productId) {
      case "standard": return tt.standard;
      case "pro": return tt.pro;
      default: return null;
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          {tp.pageTitle}
        </h1>
        <p className="max-w-lg text-muted-foreground">
          {tp.pageSub}
        </p>
      </div>

      {!hasUsedTrial && (
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-6 text-center sm:flex-row sm:justify-between sm:text-start">
          <div className="flex items-center gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Gift className="size-6" />
            </div>
            <div>
              <p className="font-semibold">{t.trialTitle}</p>
              <p className="text-sm text-muted-foreground">
                {t.trialDesc}
              </p>
            </div>
          </div>
          <GlowButton className="w-full sm:w-auto shrink-0" onClick={() => setTrialOpen(true)}>
            <Gift className="me-2 h-4 w-4" /> {t.trialCta}
          </GlowButton>
        </div>
      )}

      {categoriesLoading ? (
        <div className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-10 animate-pulse rounded-md bg-card" />)}
        </div>
      ) : (
        <Tabs value={currentTab} onValueChange={setActiveCategory} className="mx-auto max-w-6xl space-y-6">
          <TabsList className="h-auto flex-wrap justify-center">
            {sortedCategories.map((cat) => {
              const Icon = productIcon(cat.icon);
              return (
                <TabsTrigger key={cat.id} value={cat.id}>
                  <Icon className="me-1.5 size-4" /> {fa ? cat.labelFa : cat.labelEn}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {sortedCategories.map((cat) => (
            <TabsContent key={cat.id} value={cat.id}>
              {cat.id === "bot" ? (
                <BotCategoryGrid tierText={tierText} tt={tt} t={t} lang={lang} fa={fa} ArrowIcon={ArrowIcon} />
              ) : (
                <CategoryProductGrid category={cat} lang={lang} fa={fa} tp={tp} />
              )}
            </TabsContent>
          ))}
        </Tabs>
      )}

      {/* ── Admin-defined subscription plans ─────────────────────────────── */}
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="text-center">
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{t.plansTitle}</h2>
          <p className="text-sm text-muted-foreground">{t.plansSub}</p>
        </div>

        {plansLoading ? (
          <div className="grid gap-6 md:grid-cols-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-80 animate-pulse rounded-lg bg-card" />)}
          </div>
        ) : plans && plans.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => {
              const isCurrent = currentPlan?.planId === plan.id;
              const isBusy = busyPlanId === plan.id;
              const intervalLabel = plan.interval === "yearly" ? t.intervalYearly : t.intervalMonthly;
              return (
                <MotionCard key={plan.id} className={`flex flex-col ${plan.popular ? "relative border-primary shadow-md" : ""}`}>
                  {plan.popular && (
                    <div className="absolute top-0 right-0 z-10 translate-x-1/4 -translate-y-1/2 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
                      {t.popular}
                    </div>
                  )}
                  <CardHeader>
                    <CardTitle className="text-2xl">{plan.name}</CardTitle>
                    <div className="mt-2 flex items-baseline gap-2 text-3xl font-extrabold">
                      {plan.price === 0 ? t.free : formatToman(plan.price, lang)}
                      {plan.price > 0 && (
                        <span className="text-base font-medium text-muted-foreground">/{intervalLabel}</span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 space-y-3">
                    <ResourceRow ramGb={plan.ramGb} cpuCores={plan.cpuCores} maxUsers={plan.maxUsers} />
                    <ul className="space-y-2.5 text-sm">
                      <li className="flex items-start gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>{plan.maxBots} {t.botsLimit}</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>{plan.maxPlugins} {t.pluginsLimit}</span>
                      </li>
                      {plan.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                  <CardFooter>
                    {isCurrent ? (
                      <Button className="w-full" variant="outline" disabled>{t.currentPlan}</Button>
                    ) : (
                      <GlowButton
                        className="w-full"
                        wrapperClassName="w-full"
                        variant={plan.popular ? "default" : "secondary"}
                        disabled={isBusy}
                        onClick={() => requestUpgrade(plan)}
                      >
                        {isBusy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                        {t.upgrade}
                      </GlowButton>
                    )}
                  </CardFooter>
                </MotionCard>
              );
            })}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
            {t.noPlans}
          </p>
        )}
      </div>

      <AlertDialog open={!!pendingPlan} onOpenChange={(o) => !o && setPendingPlan(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.confirmUpgradeTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {/* فاز ۱۳: ارتقا فقط تفاوتِ قیمت را می‌گیرد، نه قیمتِ کاملِ پلن —
                  همان چیزی که سرور واقعاً از کیف‌پول کم می‌کند. */}
              {pendingPlan &&
                t.confirmUpgradeBody
                  .replace("{plan}", pendingPlan.name)
                  .replace("{price}", formatToman(Math.max(0, pendingPlan.price - currentPlanPrice), lang))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={subscribe.isPending}>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (pendingPlan) applyPlan(pendingPlan); }}
              disabled={subscribe.isPending}
            >
              {subscribe.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {t.confirmUpgrade}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TrialDialog open={trialOpen} onOpenChange={setTrialOpen} />
    </div>
  );
}

/** دسته‌ی «بات» — دقیقاً همان کارت‌های قبلی، فقط داده از products (category=bot) می‌آید. */
function BotCategoryGrid({
  tierText, tt, t, lang, fa, ArrowIcon,
}: {
  tierText: (id: string) => { name: string; tagline: string; features: string[] } | null;
  tt: Record<string, any>;
  t: Record<string, any>;
  lang: Lang;
  fa: boolean;
  ArrowIcon: typeof ArrowLeft;
}) {
  const { data: botProducts, isLoading } = useListProducts("bot");
  const sorted = [...(botProducts ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  if (isLoading) {
    return (
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3].map((i) => <div key={i} className="h-96 animate-pulse rounded-lg bg-card" />)}
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
      {sorted.map((product) => {
        const meta = (product.metadata ?? {}) as Record<string, any>;
        const text = tierText(product.id);
        const Icon = productIcon(product.icon);
        const accent = typeof meta.accent === "string" ? meta.accent : "from-slate-400 to-slate-300";
        const popular = !!meta.popular;
        return (
          <MotionCard
            key={product.id}
            className={`flex flex-col ${popular ? "border-primary shadow-md relative" : ""}`}
          >
            {popular && (
              <div className="absolute top-0 right-0 z-10 translate-x-1/4 -translate-y-1/2 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
                {tt.popular}
              </div>
            )}
            <div className="flex flex-1 flex-col overflow-hidden rounded-xl">
              <div className={`h-1.5 w-full bg-gradient-to-r ${accent}`} />
              <CardHeader>
                <div className={`mb-2 flex size-11 items-center justify-center rounded-lg bg-gradient-to-br ${accent} text-white`}>
                  <Icon className="size-5" />
                </div>
                <CardTitle className="text-xl">{text?.name ?? product.name}</CardTitle>
                <p className="text-sm text-muted-foreground">{text?.tagline ?? product.description}</p>
                <div className="mt-3 flex items-baseline gap-1 text-2xl font-extrabold">
                  {formatToman(product.price, lang)}
                </div>
              </CardHeader>
              <CardContent className="flex-1 space-y-3">
                <ResourceRow ramGb={Number(meta.ramGb)} cpuCores={Number(meta.cpuCores)} maxUsers={Number(meta.maxConcurrentUsers)} />
                <ul className="space-y-2.5 text-sm">
                  {(text?.features ?? []).map((f: string) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button className="w-full" variant={popular ? "default" : "secondary"} asChild>
                  <Link href={`/products/${product.id}`}>
                    {t.viewSelect} <ArrowIcon className="ms-2 h-4 w-4" />
                  </Link>
                </Button>
              </CardFooter>
            </div>
          </MotionCard>
        );
      })}

      {/* Custom package card — temporarily disabled: no price/details, no
          link, just a clear "not available right now" state. Kept visible
          (not removed) so it's obvious this is coming back, not gone.
          Deliberately out of the `products` migration (PROGRESS.md Phase 1). */}
      <MotionCard className="flex flex-col overflow-hidden border-dashed opacity-60">
        <div className="h-1.5 w-full bg-gradient-to-r from-violet-400 to-fuchsia-300" />
        <CardHeader>
          <div className="mb-2 flex size-11 items-center justify-center rounded-lg bg-gradient-to-br from-violet-400 to-fuchsia-300 text-white">
            <Settings2 className="size-5" />
          </div>
          <CardTitle className="text-xl">{tt.custom.name}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {tt.custom.tagline}
          </p>
        </CardHeader>
        <CardContent className="flex-1 space-y-2">
          <p className="text-sm text-muted-foreground">
            {t.customUnavailable}
          </p>
        </CardContent>
        <CardFooter>
          <Button className="w-full" variant="outline" disabled>
            {t.buildCustom}
          </Button>
        </CardFooter>
      </MotionCard>
    </div>
  );
}

/** دسته‌های غیرِ بات — فعلاً فقط نمایشی، بدونِ مسیرِ خرید (هنوز چیزی برایِ این دسته‌ها فروخته نمی‌شود). */
function CategoryProductGrid({
  category, lang, fa, tp,
}: {
  category: ProductCategory;
  lang: Lang;
  fa: boolean;
  tp: Record<string, any>;
}) {
  const { data: products, isLoading } = useListProducts(category.id);

  if (isLoading) {
    return (
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-40 animate-pulse rounded-lg bg-card" />)}
      </div>
    );
  }

  if (!products || products.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-16 text-center">
        <PackageOpen className="mx-auto mb-3 size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{tp.categoryEmpty}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {products.map((product) => (
        <MotionCard key={product.id} className="flex flex-col">
          <CardHeader>
            <CardTitle className="text-lg">{pluginName(product, lang, product.id)}</CardTitle>
            {pluginDescription(product, lang) && (
              <p className="text-sm text-muted-foreground">{pluginDescription(product, lang)}</p>
            )}
          </CardHeader>
          <CardContent className="flex-1">
            <div className="text-xl font-extrabold">{formatToman(product.price, lang)}</div>
          </CardContent>
          <CardFooter>
            <Button className="w-full" variant="outline" disabled>{tp.comingSoon}</Button>
          </CardFooter>
        </MotionCard>
      ))}
    </div>
  );
}

/** RAM / CPU / concurrent-user ceiling, shown identically for tiers and plans. */
function ResourceRow({
  ramGb,
  cpuCores,
  maxUsers,
}: {
  ramGb?: number;
  cpuCores?: number;
  maxUsers?: number;
}) {
  const { lang } = useLanguage();
  const t = useT("buyBot");
  const nf = (n: number) => n.toLocaleString(lang === "fa" ? "fa-IR" : "en-US");

  // A plan created before these columns existed has no sizing to show.
  if (ramGb == null && cpuCores == null && maxUsers == null) return null;

  return (
    <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-2 text-center text-xs">
      {ramGb != null && Number.isFinite(ramGb) && (
        <div className="flex flex-col items-center gap-0.5">
          <MemoryStick className="size-3.5 text-primary" />
          <span className="font-semibold">{nf(ramGb)} {t.gb}</span>
          <span className="text-muted-foreground">{t.ram}</span>
        </div>
      )}
      {cpuCores != null && Number.isFinite(cpuCores) && (
        <div className="flex flex-col items-center gap-0.5">
          <Cpu className="size-3.5 text-primary" />
          <span className="font-semibold">{nf(cpuCores)}</span>
          <span className="text-muted-foreground">{t.cpu}</span>
        </div>
      )}
      {maxUsers != null && Number.isFinite(maxUsers) && (
        <div className="flex flex-col items-center gap-0.5">
          <Users className="size-3.5 text-primary" />
          <span className="font-semibold">{nf(maxUsers)}</span>
          <span className="text-muted-foreground">{t.concurrentUsers}</span>
        </div>
      )}
    </div>
  );
}
