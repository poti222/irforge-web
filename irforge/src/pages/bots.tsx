import { useListBots } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Bot as BotIcon, ArrowRight, Gift, Settings } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useListMyPurchases } from "@/hooks/use-products";
import { productIcon } from "@/lib/product-icons";
import { botLifetime, LIFETIME_TONE } from "@/lib/bot-lifetime";
import { PageHeader } from "@/components/forge-ui/PageHeader";
import { StatusPill } from "@/components/forge-ui/LiveDot";
import { botStatusMeta } from "@/lib/bot-status";

/**
 * IRFORGE_MY_PRODUCTS_SEO_PLANS_PROMPT Section A — this page (still `/bots`,
 * still `Bots` as the component name — the route and every existing deep
 * link into it stay valid) now shows a user's non-bot purchases too, under
 * their own clearly-headed section, alongside the bot cards this page
 * already had. Only rendered once there's something real to show (no
 * self-serve checkout exists yet for non-bot products — see
 * `use-products.ts::useListMyPurchases()`'s own header) so it doesn't sit
 * as a permanently-empty section for every user today.
 */
function OtherProductsSection() {
  const { lang } = useLanguage();
  const t = useT("bots");
  const { data: purchases, isLoading } = useListMyPurchases();

  if (!isLoading && (!purchases || purchases.length === 0)) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">{t.otherProductsTitle}</h2>
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="h-16" />
              <CardContent className="h-16" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {purchases!.map((purchase) => {
            const Icon = productIcon(purchase.product.icon);
            const name = lang === "fa" ? purchase.product.nameFa || purchase.product.name : purchase.product.name;
            const categoryLabel = lang === "fa" ? purchase.category.labelFa : purchase.category.labelEn;
            return (
              <Card key={purchase.id}>
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{name}</p>
                    <p className="truncate text-sm text-muted-foreground">{categoryLabel}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Bots() {
  usePrivatePageTitle(useT("pageTitles").bots);
  const { lang } = useLanguage();
  const t = useT("bots");
  const tw = useT("botWorkspace");
  const { data: bots, isLoading } = useListBots();
  const nf = (n: number | undefined) => (n ?? 0).toLocaleString(lang === "fa" ? "fa-IR" : "en-US");

  return (
    <div className="space-y-10">
      {/* Creating a bot now always starts from the Buy Bot flow. */}
      <PageHeader
        icon={<BotIcon />}
        title={t.title}
        description={bots && bots.length > 0 ? `${nf(bots.length)} · ${t.myBotsTitle}` : t.myBotsTitle}
        actions={
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href="/products">
              <Plus className="me-2 h-4 w-4" /> {t.createNewBot}
            </Link>
          </Button>
        }
      />

      <div className="space-y-3">
      {isLoading ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="h-24" />
              <CardContent className="h-28" />
            </Card>
          ))}
        </div>
      ) : bots && bots.length > 0 ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {bots.map((bot) => {
            const st = botStatusMeta(bot.status, lang);
            const life = botLifetime(bot, lang);
            return (
              <Card key={bot.id} className="group flex flex-col overflow-hidden transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]">
                <div className="relative bg-gradient-to-br from-primary/[0.12] via-primary/[0.04] to-transparent px-5 pb-4 pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3.5">
                      {/* the bot's own Telegram profile photo when it has one —
                          makes a list of several bots scannable at a glance */}
                      {bot.avatar ? (
                        <img
                          src={bot.avatar}
                          alt={t.botAvatarAlt}
                          loading="lazy"
                          className="size-14 shrink-0 rounded-2xl border border-border object-cover ring-4 ring-background"
                        />
                      ) : (
                        <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/.25),0_10px_20px_-10px_hsl(var(--primary)/.8)] ring-4 ring-background">
                          <BotIcon className="h-7 w-7" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-bold leading-tight">{bot.name}</h3>
                        {bot.username ? (
                          <a
                            href={`https://t.me/${bot.username}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            dir="ltr"
                            className="block truncate text-start text-sm text-muted-foreground hover:text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            @{bot.username}
                          </a>
                        ) : (
                          <p className="truncate text-sm text-muted-foreground">{t.noUsername}</p>
                        )}
                      </div>
                    </div>
                    <StatusPill tone={st.tone} pulse={st.pulse}>{st.label}</StatusPill>
                  </div>
                  {life && (
                    <Badge
                      variant="outline"
                      data-testid="bot-lifetime-badge"
                      className={`mt-3 flex w-fit items-center gap-1 ${LIFETIME_TONE[life.tone]}`}
                    >
                      <Gift className="size-3" />
                      {life.text}
                    </Badge>
                  )}
                </div>
                <CardContent className="flex flex-1 flex-col gap-4 p-5 pt-4">
                  <p className="line-clamp-2 min-h-10 text-sm leading-relaxed text-muted-foreground">
                    {bot.description || t.noDescription}
                  </p>
                  <dl className="grid grid-cols-3 divide-x divide-border/70 rounded-xl bg-muted/50 py-2.5 text-center rtl:divide-x-reverse">
                    {[
                      [t.usersLabel, bot.userCount],
                      [t.commandsLabel, bot.commandCount],
                      [tw.overviewPlugins, bot.pluginCount],
                    ].map(([label, n]) => (
                      <div key={label as string} className="px-2">
                        <dd className="text-base font-bold tabular-nums">{nf(n as number | undefined)}</dd>
                        <dt className="truncate text-[0.7rem] text-muted-foreground">{label}</dt>
                      </div>
                    ))}
                  </dl>
                </CardContent>
                <CardFooter className="gap-2 p-5 pt-0">
                  <Button className="flex-1" asChild>
                    <Link href={`/bots/${bot.id}`}>
                      {t.manageBot} <ArrowRight className="ms-2 h-4 w-4 rtl-flip" />
                    </Link>
                  </Button>
                  {/* Straight to the gear — the settings section is where most
                      return visits go, and the workspace reads the section from
                      the URL, so this deep link lands exactly there. */}
                  <Button variant="outline" size="icon" className="shrink-0" asChild title={t.botSettingsShortcut}>
                    <Link href={`/bots/${bot.id}?section=settings`} aria-label={t.botSettingsShortcut}>
                      <Settings className="h-4 w-4" />
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-border bg-card/60 px-6 py-20 text-center">
          <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
            <BotIcon className="h-8 w-8" />
          </div>
          <h2 className="mb-2 text-xl font-semibold">{t.noBotsTitle}</h2>
          <p className="mx-auto mb-6 max-w-sm text-muted-foreground">
            {t.noBotsDesc}
          </p>
          <Button asChild size="lg">
            <Link href="/products">
              <Plus className="me-2 h-4 w-4" /> {t.createFirstBot}
            </Link>
          </Button>
        </div>
      )}
      </div>

      <OtherProductsSection />
    </div>
  );
}
