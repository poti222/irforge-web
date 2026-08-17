/**
 * PluginLibrary.tsx — فهرست پلاگین‌ها در دو بخش.
 *
 * بالا: پلاگین‌هایی که **داری** — با اینکه روی کدام بات نشسته، میان‌بر به بخش
 * مدیریتش در همان بات، و امکان انتقال به بات دیگر.
 * پایین: پلاگین‌هایی که **نداری** — با قیمت و انتخابگر «برای کدام بات؟».
 *
 * مرز دو بخش `owned` است، پس به‌محض خرید، پلاگین از پایین حذف و بالا ظاهر
 * می‌شود؛ همان رفتاری که خواسته شده بود و قبلاً وجود نداشت (یک فهرست تخت که
 * خریده و نخریده را قاطی نشان می‌داد).
 *
 * همین کامپوننت هم در صفحه‌ی مارکت‌پلیس داشبورد استفاده می‌شود و هم در سکشن
 * پلاگین‌های هر بات — با `scopeBotId` که آن بات را پیش‌فرضِ انتخابگر می‌کند.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft, ArrowRight, Blocks, Check, Info, Loader2, MoveRight, ShoppingCart, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";
import { pluginName, pluginDescription } from "@/lib/plugin-text";
import { SECTION_LABEL_KEYS } from "@/lib/plugin-sections";
import {
  usePluginLicences, useMoveLicence, useBuyPluginForBot, useRemoveLicence,
  type LicencedPlugin, type LicenceBot,
} from "@/hooks/use-plugin-licences";

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}

/** کارت یک پلاگینِ داشته: کجا نشسته، مدیریتش، و انتقالش. */
function OwnedCard({ plugin, bots }: { plugin: LicencedPlugin; bots: LicenceBot[] }) {
  const t = useT("botPlugins");
  const tw = useT("botWorkspace");
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const ArrowIcon = fa ? ArrowLeft : ArrowRight;
  const { toast } = useToast();

  const move = useMoveLicence();
  const remove = useRemoveLicence();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const licence = plugin.licences[0];
  const sectionKey = plugin.webSection ? SECTION_LABEL_KEYS[plugin.webSection] : undefined;
  const sectionLabel = sectionKey ? (tw[sectionKey] as string) : null;

  // بات‌هایی که این لایسنس می‌تواند به آن‌ها برود: هر باتی جز آن‌هایی که همین
  // پلاگین را دارند (سرور هم همین را ۴۰۹ می‌کند؛ اینجا فقط پیشگیری از خطای
  // بی‌دلیل است).
  const taken = new Set(plugin.licences.map((l) => l.botId));
  const movableTo = bots.filter((b) => !taken.has(b.id));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-start gap-2 text-base">
          <Blocks className="mt-0.5 size-4 shrink-0 text-primary" />
          <Link
            href={`/marketplace/${plugin.id}`}
            className="min-w-0 flex-1 hover:underline"
          >
            {pluginName(plugin, lang, plugin.id)}
          </Link>
          <Badge variant="secondary" className="shrink-0 gap-1">
            <Check className="size-3" /> {t.purchased}
          </Badge>
        </CardTitle>
        <CardDescription className="line-clamp-2">
          {pluginDescription(plugin, lang)}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 text-xs">
        {licence && (
          <p className="flex items-start gap-1.5 rounded-md bg-muted/60 px-2.5 py-2 text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {t.installedOnBot.replace("{bot}", licence.botName || licence.botId)}
              {sectionLabel && ` · ${t.managedIn.replace("{section}", sectionLabel)}`}
            </span>
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {licence && sectionLabel && (
            <Button size="sm" asChild>
              <Link href={`/bots/${licence.botId}?section=${plugin.webSection}`}>
                {t.manage} <ArrowIcon className="size-3.5" />
              </Link>
            </Button>
          )}
          <Button size="sm" variant="ghost" asChild>
            <Link href={`/marketplace/${plugin.id}`}>{t.details}</Link>
          </Button>
          {licence && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmRemove(licence.licenceId)}
              title={t.removeFromBot}
            >
              <Trash2 className="size-3.5 text-destructive" />
            </Button>
          )}
        </div>

        {/* انتقال به بات دیگر — تنها وقتی بات دیگری هست که نداشته باشدش. */}
        {licence && movableTo.length > 0 && (
          <div className="space-y-1.5 border-t pt-3">
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <MoveRight className="size-3.5" /> {t.moveToAnotherBot}
            </p>
            <Select
              value=""
              onValueChange={(botId) =>
                move.mutate(
                  { licenceId: licence.licenceId, botId },
                  {
                    onSuccess: () => toast({ title: t.moved }),
                    onError: (err: any) =>
                      toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
                  },
                )
              }
              disabled={move.isPending}
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder={t.chooseBot} />
              </SelectTrigger>
              <SelectContent>
                {movableTo.map((bot) => (
                  <SelectItem key={bot.id} value={bot.id}>{bot.name || bot.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirmRemove !== null} onOpenChange={(open) => !open && setConfirmRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.removeFromBotTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.removeFromBotWarning}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                licence && remove.mutate(
                  { botId: licence.botId, licenceId: licence.licenceId },
                  {
                    onSuccess: () => { toast({ title: t.removed }); setConfirmRemove(null); },
                    onError: (err: any) =>
                      toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
                  },
                )
              }
            >
              {t.removeFromBot}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/**
 * کارت یک پلاگینِ داشته که روی *این* بات نیست — با یک دکمه‌ی «انتقال به همین بات».
 *
 * بی این کارت، در صفحه‌ی یک بات، پلاگینی که روی بات دیگرت نشسته در هیچ‌کدام از دو
 * بخش نبود: نه «قابل خرید» بود (داری‌اش) و نه روی این بات نصب. یعنی گم می‌شد.
 */
function ElsewhereCard({ plugin, scopeBotId }: { plugin: LicencedPlugin; scopeBotId: string }) {
  const t = useT("botPlugins");
  const { lang } = useLanguage();
  const { toast } = useToast();
  const move = useMoveLicence();
  const licence = plugin.licences[0];
  if (!licence) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-start gap-2 text-base">
          <Blocks className="mt-0.5 size-4 shrink-0 text-primary" />
          <Link href={`/marketplace/${plugin.id}`} className="min-w-0 flex-1 hover:underline">
            {pluginName(plugin, lang, plugin.id)}
          </Link>
          <Badge variant="secondary" className="shrink-0 gap-1">
            <Check className="size-3" /> {t.purchased}
          </Badge>
        </CardTitle>
        <CardDescription className="line-clamp-2">
          {pluginDescription(plugin, lang)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <p className="flex items-start gap-1.5 rounded-md bg-muted/60 px-2.5 py-2 text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>{t.installedOnBot.replace("{bot}", licence.botName || licence.botId)}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={move.isPending}
            onClick={() =>
              move.mutate(
                { licenceId: licence.licenceId, botId: scopeBotId },
                {
                  onSuccess: () => toast({ title: t.moved }),
                  onError: (err: any) =>
                    toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
                },
              )
            }
          >
            {move.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <MoveRight className="size-3.5" />}
            {t.moveHere}
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link href={`/marketplace/${plugin.id}`}>{t.details}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** کارت یک پلاگینِ نداشته: قیمت، و «برای کدام بات؟». */
function AvailableCard({
  plugin, bots, scopeBotId,
}: {
  plugin: LicencedPlugin;
  bots: LicenceBot[];
  scopeBotId?: string;
}) {
  const t = useT("botPlugins");
  const tw = useT("botWorkspace");
  const { lang } = useLanguage();
  const { toast } = useToast();

  const buy = useBuyPluginForBot();
  // بات پیش‌فرض: باتی که در آن هستیم، وگرنه اگر فقط یک بات داری همان.
  const [botId, setBotId] = useState<string>(scopeBotId ?? (bots.length === 1 ? bots[0].id : ""));

  const sectionKey = plugin.webSection ? SECTION_LABEL_KEYS[plugin.webSection] : undefined;
  const sectionLabel = sectionKey ? (tw[sectionKey] as string) : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-start gap-2 text-base">
          <Blocks className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <Link href={`/marketplace/${plugin.id}`} className="min-w-0 flex-1 hover:underline">
            {pluginName(plugin, lang, plugin.id)}
          </Link>
          <Badge variant={plugin.isFree ? "secondary" : "default"} className="shrink-0">
            {plugin.isFree ? t.free : formatToman(plugin.price, lang)}
          </Badge>
        </CardTitle>
        <CardDescription className="line-clamp-2">
          {pluginDescription(plugin, lang)}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 text-xs">
        {sectionLabel && (
          <p className="flex items-start gap-1.5 text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>{t.sectionAfterEnable.replace("{section}", sectionLabel)}</span>
          </p>
        )}

        {bots.length === 0 ? (
          <p className="rounded-md border border-dashed p-2.5 text-muted-foreground">
            {t.needABotFirst}
          </p>
        ) : (
          <div className="space-y-1.5">
            <p className="text-muted-foreground">{t.buyForWhichBot}</p>
            <div className="flex gap-2">
              <Select value={botId} onValueChange={setBotId}>
                <SelectTrigger className="h-8 flex-1">
                  <SelectValue placeholder={t.chooseBot} />
                </SelectTrigger>
                <SelectContent>
                  {bots.map((bot) => (
                    <SelectItem key={bot.id} value={bot.id}>{bot.name || bot.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!botId || buy.isPending}
                onClick={() =>
                  buy.mutate(
                    { botId, marketplaceItemId: plugin.marketplaceItemId, pluginId: plugin.id },
                    {
                      onSuccess: () => toast({ title: plugin.isFree ? t.installed : t.purchaseDone }),
                      onError: (err: any) =>
                        toast({
                          variant: "destructive",
                          title: t.errorGeneric,
                          description: errMessage(err, t.errorGeneric),
                        }),
                    },
                  )
                }
              >
                {buy.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <ShoppingCart className="size-3.5" />}
                {plugin.isFree ? t.install : t.buy}
              </Button>
            </div>
          </div>
        )}

        <Link href={`/marketplace/${plugin.id}`} className="inline-block text-primary hover:underline">
          {t.details}
        </Link>
      </CardContent>
    </Card>
  );
}

/**
 * @param scopeBotId  اگر داخل صفحه‌ی یک بات هستیم: پیش‌فرضِ انتخابگرِ «برای کدام
 *                    بات؟» و مبنای بخش «داری ولی روی بات دیگری است».
 * @param only        در صفحه‌ی بات، بخش «داشته‌ها» را خودِ لیست سوییچ‌های آن بات
 *                    نشان می‌دهد، پس اینجا فقط «قابل خرید» لازم است.
 */
export function PluginLibrary({
  scopeBotId,
  only = "both",
}: {
  scopeBotId?: string;
  only?: "both" | "available";
}) {
  const t = useT("botPlugins");
  const { lang } = useLanguage();
  const { data, isLoading, error } = usePluginLicences();

  const { owned, elsewhere, available } = useMemo(() => {
    const plugins = data?.plugins ?? [];
    const byName = (a: LicencedPlugin, b: LicencedPlugin) =>
      pluginName(a, lang, a.id).localeCompare(pluginName(b, lang, b.id));
    // گران‌ترها اول: پلاگین‌های اصلیِ درآمدساز باید اول دیده شوند.
    const byPrice = (a: LicencedPlugin, b: LicencedPlugin) => b.price - a.price;
    return {
      owned: plugins.filter((p) => p.owned).sort(byName),
      elsewhere: scopeBotId
        ? plugins
            .filter((p) => p.owned && !p.licences.some((l) => l.botId === scopeBotId))
            .sort(byName)
        : [],
      available: plugins.filter((p) => !p.owned).sort(byPrice),
    };
  }, [data, lang, scopeBotId]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t.loading}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        {errMessage(error, t.errorGeneric)}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {only === "both" && (
        <section>
          <h3 className="mb-1 text-base font-semibold">
            {t.ownedTitle}{" "}
            <Badge variant="outline" className="tabular-nums align-middle">
              {owned.length.toLocaleString(lang === "fa" ? "fa-IR" : "en-US")}
            </Badge>
          </h3>
          <p className="mb-3 text-sm text-muted-foreground">{t.ownedDesc}</p>

          {owned.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t.ownedEmpty}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {owned.map((plugin) => (
                <OwnedCard key={plugin.id} plugin={plugin} bots={data.bots} />
              ))}
            </div>
          )}
        </section>
      )}

      {scopeBotId && elsewhere.length > 0 && (
        <section>
          <h3 className="mb-1 text-base font-semibold">{t.elsewhereTitle}</h3>
          <p className="mb-3 text-sm text-muted-foreground">{t.elsewhereDesc}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {elsewhere.map((plugin) => (
              <ElsewhereCard key={plugin.id} plugin={plugin} scopeBotId={scopeBotId} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-1 text-base font-semibold">
          {t.availableTitle}{" "}
          <Badge variant="outline" className="tabular-nums align-middle">
            {available.length.toLocaleString(lang === "fa" ? "fa-IR" : "en-US")}
          </Badge>
        </h3>
        <p className="mb-3 text-sm text-muted-foreground">{t.availableDesc}</p>

        {available.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t.availableEmpty}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {available.map((plugin) => (
              <AvailableCard key={plugin.id} plugin={plugin} bots={data.bots} scopeBotId={scopeBotId} />
            ))}
          </div>
        )}
      </section>

      {data.catalogPublished === false && (
        <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>{t.catalogUnpublished}</span>
        </p>
      )}
    </div>
  );
}
