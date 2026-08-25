/**
 * plugin-detail.tsx — `/marketplace/:pluginId`
 *
 * یک صفحه‌ی واقعی به‌ازای هر پلاگین (نه یک دیالوگ)، پس قابل بوکمارک و
 * اشتراک‌گذاری است: توضیح کامل، قیمت، اینکه کدام بخش را باز می‌کند، روی کدام
 * بات‌ها نشسته، و هر کاری که می‌شود با آن کرد — خرید برای یک یا چند باتِ
 * انتخابی هم‌زمان، رفتن به بخش مدیریتش، یا انتقال یک لایسنس به بات دیگر.
 *
 * IRFORGE_PROMPT_V3 Phase 37 — تا امروز به‌محض خریدِ یک پلاگین روی هر باتی،
 * کل بخشِ «خرید» از این صفحه ناپدید می‌شد؛ کاربری با سه بات که می‌خواست همان
 * پلاگین را روی هرسه‌شان داشته باشد راهی جز حذف‌نصب/جابه‌جاییِ دستی نداشت،
 * چون UI فرض می‌کرد «مالکیت» یعنی مالکیتِ کاملِ روی *هر* باتی که لازم است.
 * سرور از اول محدودیتی نداشت — هر خرید یک ردیفِ مستقل در `installed_plugins`
 * است — پس این فقط رفعِ محدودیتِ رابط کاربری بود: بخشِ «داشته‌ها» حالا هر
 * لایسنس را جدا نشان می‌دهد، و بخشِ «خرید» تا وقتی حتی یک بات بدون این
 * پلاگین هست باز می‌ماند، با یک چک‌لیستِ چندانتخابی به‌جای یک Select تکی.
 */
import { Link, useParams } from "wouter";
import {
  ArrowLeft, ArrowRight, Blocks, Check, Info, Loader2, MoveRight, ShoppingCart, Table2, History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { formatToman } from "@/lib/format";
import { pluginName, pluginDescription } from "@/lib/plugin-text";
import { SECTION_LABEL_KEYS } from "@/lib/plugin-sections";
import {
  usePluginLicences, useMoveLicence, useBuyPluginForBots,
} from "@/hooks/use-plugin-licences";

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}

type ReleaseNote = { id: string; version: string; title: string; body: string; createdAt: string };

export default function PluginDetail() {
  const { pluginId } = useParams<{ pluginId: string }>();
  const t = useT("botPlugins");
  const tw = useT("botWorkspace");
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const BackArrow = fa ? ArrowRight : ArrowLeft;
  const { toast } = useToast();

  const { data, isLoading, error } = usePluginLicences();
  const { data: releaseNotes } = useQuery({
    queryKey: ["plugin-release-notes", pluginId],
    queryFn: () => customFetch<ReleaseNote[]>(`/api/plugins/${pluginId}/release-notes`),
    enabled: Boolean(pluginId),
  });
  const buy = useBuyPluginForBots();
  const move = useMoveLicence();
  const [selectedBotIds, setSelectedBotIds] = useState<string[]>([]);
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});

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
  const sectionKey = plugin.webSection ? SECTION_LABEL_KEYS[plugin.webSection] : undefined;
  const sectionLabel = sectionKey ? (tw[sectionKey] as string) : null;
  const taken = new Set(plugin.licences.map((l) => l.botId));
  // بات‌هایی که این پلاگین را ندارند — هم مقصدِ «جابه‌جایی» یک لایسنسِ موجود‌اند
  // و هم چک‌لیستِ «خرید برای» زیر.
  const availableBots = bots.filter((b) => !taken.has(b.id));
  const botName = (id: string) => bots.find((b) => b.id === id)?.name || id;

  const toggleBot = (botId: string, checked: boolean) => {
    setSelectedBotIds((prev) => (checked ? [...prev, botId] : prev.filter((id) => id !== botId)));
  };

  const submitPurchase = () => {
    if (selectedBotIds.length === 0) return;
    const botNames = Object.fromEntries(selectedBotIds.map((id) => [id, botName(id)]));
    buy.mutate(
      { botIds: selectedBotIds, marketplaceItemId: plugin.marketplaceItemId, pluginId: plugin.id, botNames },
      {
        onSuccess: (results) => {
          const okCount = results.filter((r) => r.ok).length;
          setSelectedBotIds([]);
          if (results.length === 1 && okCount === 1) {
            toast({ title: plugin.isFree ? t.installed : t.purchaseDone });
          } else if (okCount === results.length) {
            toast({ title: plugin.isFree ? t.installed : t.purchaseSummaryAll.replace("{n}", String(okCount)) });
          } else if (okCount === 0) {
            toast({
              variant: "destructive",
              title: t.purchaseSummaryNone,
              description: results[0]?.error,
            });
          } else {
            toast({
              title: t.purchaseSummaryPartial.replace("{ok}", String(okCount)).replace("{total}", String(results.length)),
              description: results.filter((r) => !r.ok).map((r) => `${r.botName}: ${r.error}`).join(" · "),
            });
          }
        },
        onError: (err: any) => toast({
          variant: "destructive", title: t.errorGeneric,
          description: errMessage(err, t.errorGeneric),
        }),
      },
    );
  };

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

          {/* ── داشته‌ها: هر لایسنس با بات و اقدام‌های خودش ── */}
          {plugin.licences.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium">{t.installedOnBots}</p>
              {plugin.licences.map((licence) => (
                <div key={licence.licenceId} className="space-y-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{licence.botName || licence.botId}</span>
                    <div className="flex flex-wrap gap-2">
                      {sectionLabel && (
                        <Button size="sm" asChild>
                          <Link href={`/bots/${licence.botId}?section=${plugin.webSection}`}>{t.manage}</Link>
                        </Button>
                      )}
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/bots/${licence.botId}?section=plugins`}>{t.botPluginsSection}</Link>
                      </Button>
                    </div>
                  </div>

                  {availableBots.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MoveRight className="size-3.5" /> {t.moveToAnotherBot}
                      </span>
                      <Select
                        value={moveTargets[licence.licenceId] ?? ""}
                        onValueChange={(v) => setMoveTargets((prev) => ({ ...prev, [licence.licenceId]: v }))}
                      >
                        <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder={t.chooseBot} /></SelectTrigger>
                        <SelectContent>
                          {availableBots.map((bot) => (
                            <SelectItem key={bot.id} value={bot.id}>{bot.name || bot.id}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!moveTargets[licence.licenceId] || move.isPending}
                        onClick={() =>
                          move.mutate(
                            { licenceId: licence.licenceId, botId: moveTargets[licence.licenceId] },
                            {
                              onSuccess: () => {
                                toast({ title: t.moved });
                                setMoveTargets((prev) => { const next = { ...prev }; delete next[licence.licenceId]; return next; });
                              },
                              onError: (err: any) => toast({
                                variant: "destructive", title: t.errorGeneric,
                                description: errMessage(err, t.errorGeneric),
                              }),
                            },
                          )
                        }
                      >
                        {move.isPending && <Loader2 className="me-2 size-3.5 animate-spin" />}
                        {t.moveAction}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              <p className="text-xs text-muted-foreground">{t.moveHint}</p>
            </div>
          )}

          {plugin.licences.length > 0 && availableBots.length > 0 && <Separator />}

          {/* ── خرید برای بات‌های دیگر — تا وقتی حتی یکی بی این پلاگین است ── */}
          {availableBots.length > 0 && (
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
                  <p className="text-sm font-medium">
                    {availableBots.length > 1 ? t.buyForWhichBots : t.buyForWhichBot}
                  </p>
                  {availableBots.length > 1 && (
                    <p className="text-xs text-muted-foreground">{t.selectBotsHint}</p>
                  )}
                  <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-md border p-2">
                    {availableBots.map((bot) => (
                      <label
                        key={bot.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md p-1.5 text-sm hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={selectedBotIds.includes(bot.id)}
                          onCheckedChange={(checked) => toggleBot(bot.id, checked === true)}
                        />
                        <span className="flex-1">{bot.name || bot.id}</span>
                      </label>
                    ))}
                  </div>
                  <Button
                    disabled={selectedBotIds.length === 0 || buy.isPending}
                    onClick={submitPurchase}
                  >
                    {buy.isPending
                      ? <Loader2 className="me-2 size-4 animate-spin" />
                      : <ShoppingCart className="me-2 size-4" />}
                    {plugin.isFree
                      ? (selectedBotIds.length > 1 ? t.installSelected.replace("{n}", String(selectedBotIds.length)) : t.install)
                      : `${t.buy} — ${formatToman(plugin.price * Math.max(selectedBotIds.length, 1), lang)}`
                        + (selectedBotIds.length > 1 ? ` (${selectedBotIds.length})` : "")}
                  </Button>
                  <p className="text-xs text-muted-foreground">{t.paidFromWallet}</p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {releaseNotes && releaseNotes.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="size-4 text-muted-foreground" /> {t.releaseNotesTitle}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {releaseNotes.map((note) => (
              <div key={note.id} className="space-y-1 border-b pb-3 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" dir="ltr">v{note.version}</Badge>
                  <span className="text-sm font-medium">{note.title}</span>
                  <span className="ms-auto text-xs text-muted-foreground">
                    {new Date(note.createdAt).toLocaleDateString(fa ? "fa-IR" : "en-US")}
                  </span>
                </div>
                <p className="whitespace-pre-line text-sm text-muted-foreground">{note.body}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
