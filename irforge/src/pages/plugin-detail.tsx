/**
 * plugin-detail.tsx — `/marketplace/:pluginId`
 *
 * یک صفحه‌ی واقعی به‌ازای هر پلاگین (نه یک دیالوگ)، پس قابل بوکمارک و
 * اشتراک‌گذاری است: توضیح کامل، قیمت، اینکه کدام بخش را باز می‌کند، روی کدام
 * بات نشسته، و هر کاری که می‌شود با آن کرد — خرید برای یک باتِ انتخابی، رفتن
 * به بخش مدیریتش، یا انتقال به بات دیگر.
 */
import { Link, useParams, useLocation } from "wouter";
import {
  ArrowLeft, ArrowRight, Blocks, Check, Info, Loader2, MoveRight, ShoppingCart, Table2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { formatToman } from "@/lib/format";
import { pluginName, pluginDescription } from "@/lib/plugin-text";
import { SECTION_LABEL_KEYS } from "@/lib/plugin-sections";
import {
  usePluginLicences, useMoveLicence, useBuyPluginForBot,
} from "@/hooks/use-plugin-licences";

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}

export default function PluginDetail() {
  const { pluginId } = useParams<{ pluginId: string }>();
  const t = useT("botPlugins");
  const tw = useT("botWorkspace");
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const BackArrow = fa ? ArrowRight : ArrowLeft;
  const ForwardArrow = fa ? ArrowLeft : ArrowRight;
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data, isLoading, error } = usePluginLicences();
  const buy = useBuyPluginForBot();
  const move = useMoveLicence();
  const [botId, setBotId] = useState("");

  const plugin = data?.plugins.find((p) => p.id === pluginId);
  usePrivatePageTitle(plugin ? pluginName(plugin, lang, plugin.id) : t.detailsTitle);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t.loading}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        {errMessage(error, t.errorGeneric)}
      </div>
    );
  }

  if (!plugin) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
        <p className="text-muted-foreground">{t.pluginNotFound}</p>
        <Button asChild variant="outline">
          <Link href="/marketplace">{t.backToMarketplace}</Link>
        </Button>
      </div>
    );
  }

  const bots = data?.bots ?? [];
  const licence = plugin.licences[0];
  const sectionKey = plugin.webSection ? SECTION_LABEL_KEYS[plugin.webSection] : undefined;
  const sectionLabel = sectionKey ? (tw[sectionKey] as string) : null;
  const taken = new Set(plugin.licences.map((l) => l.botId));
  const movableTo = bots.filter((b) => !taken.has(b.id));
  const buyableBots = bots.filter((b) => !taken.has(b.id));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ms-2">
        <Link href="/marketplace">
          <BackArrow className="me-2 h-4 w-4" /> {t.backToMarketplace}
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Blocks className="size-5" />
              </div>
              <div>
                <CardTitle className="text-2xl">{pluginName(plugin, lang, plugin.id)}</CardTitle>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline" dir="ltr">v{plugin.version}</Badge>
                  <Badge variant={plugin.isFree ? "secondary" : "default"}>
                    {plugin.isFree ? t.free : formatToman(plugin.price, lang)}
                  </Badge>
                  {plugin.owned && (
                    <Badge variant="secondary" className="gap-1">
                      <Check className="size-3" /> {t.purchased}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <p className="text-sm leading-relaxed">{pluginDescription(plugin, lang)}</p>

          {sectionLabel && (
            <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" />
              <span>
                {plugin.owned
                  ? t.managedIn.replace("{section}", sectionLabel)
                  : t.sectionAfterEnable.replace("{section}", sectionLabel)}
              </span>
            </p>
          )}

          {plugin.required_sheets.length > 0 && (
            <div>
              <p className="mb-1.5 flex items-center gap-2 text-sm font-medium">
                <Table2 className="size-4 text-muted-foreground" /> {t.requiredSheets}
              </p>
              <p className="mb-2 text-xs text-muted-foreground">{t.requiredSheetsHint}</p>
              <div className="flex flex-wrap gap-1.5">
                {plugin.required_sheets.map((sheet) => (
                  <Badge key={sheet} variant="outline" dir="ltr" className="font-mono text-xs">
                    {sheet}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <Separator />

          {/* ── وقتی داری: کجا نشسته، مدیریتش، انتقالش ── */}
          {plugin.owned && licence && (
            <div className="space-y-4">
              <p className="text-sm">
                {t.installedOnBot.replace("{bot}", licence.botName || licence.botId)}
              </p>

              <div className="flex flex-wrap gap-2">
                {sectionLabel && (
                  <Button asChild>
                    <Link href={`/bots/${licence.botId}?section=${plugin.webSection}`}>
                      {t.manage} <ForwardArrow className="ms-2 size-4" />
                    </Link>
                  </Button>
                )}
                <Button variant="outline" asChild>
                  <Link href={`/bots/${licence.botId}?section=plugins`}>{t.botPluginsSection}</Link>
                </Button>
              </div>

              {movableTo.length > 0 && (
                <div className="space-y-2 rounded-lg border p-3">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <MoveRight className="size-4" /> {t.moveToAnotherBot}
                  </p>
                  <p className="text-xs text-muted-foreground">{t.moveHint}</p>
                  <div className="flex gap-2">
                    <Select value={botId} onValueChange={setBotId}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder={t.chooseBot} />
                      </SelectTrigger>
                      <SelectContent>
                        {movableTo.map((bot) => (
                          <SelectItem key={bot.id} value={bot.id}>{bot.name || bot.id}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="secondary"
                      disabled={!botId || move.isPending}
                      onClick={() =>
                        move.mutate(
                          { licenceId: licence.licenceId, botId },
                          {
                            onSuccess: () => { toast({ title: t.moved }); setBotId(""); },
                            onError: (err: any) => toast({
                              variant: "destructive", title: t.errorGeneric,
                              description: errMessage(err, t.errorGeneric),
                            }),
                          },
                        )
                      }
                    >
                      {move.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
                      {t.moveAction}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── وقتی نداری: برای کدام بات؟ ── */}
          {!plugin.owned && (
            <div className="space-y-2">
              {bots.length === 0 ? (
                <div className="space-y-3 rounded-lg border border-dashed p-4 text-center">
                  <p className="text-sm text-muted-foreground">{t.needABotFirst}</p>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/buy-bot">{t.goBuyBot}</Link>
                  </Button>
                </div>
              ) : (
                <>
                  <p className="text-sm font-medium">{t.buyForWhichBot}</p>
                  <div className="flex flex-wrap gap-2">
                    <Select value={botId} onValueChange={setBotId}>
                      <SelectTrigger className="min-w-48 flex-1">
                        <SelectValue placeholder={t.chooseBot} />
                      </SelectTrigger>
                      <SelectContent>
                        {buyableBots.map((bot) => (
                          <SelectItem key={bot.id} value={bot.id}>{bot.name || bot.id}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      disabled={!botId || buy.isPending}
                      onClick={() =>
                        buy.mutate(
                          { botId, marketplaceItemId: plugin.marketplaceItemId, pluginId: plugin.id },
                          {
                            onSuccess: () => {
                              toast({ title: plugin.isFree ? t.installed : t.purchaseDone });
                              setLocation(`/bots/${botId}?section=plugins`);
                            },
                            onError: (err: any) => toast({
                              variant: "destructive", title: t.errorGeneric,
                              description: errMessage(err, t.errorGeneric),
                            }),
                          },
                        )
                      }
                    >
                      {buy.isPending
                        ? <Loader2 className="me-2 size-4 animate-spin" />
                        : <ShoppingCart className="me-2 size-4" />}
                      {plugin.isFree ? t.install : `${t.buy} — ${formatToman(plugin.price, lang)}`}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{t.paidFromWallet}</p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
