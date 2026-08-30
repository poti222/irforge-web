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
import { motion } from "framer-motion";
import { Link } from "wouter";
import {
  ArrowLeft, ArrowRight, Blocks, Check, Info, Loader2, Search, ShoppingCart, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { useCurrency } from "@/hooks/use-currency";
import { formatToman, formatConvertedAmount } from "@/lib/format";
import { pluginName, pluginDescription } from "@/lib/plugin-text";
import { SECTION_LABEL_KEYS } from "@/lib/plugin-sections";
import {
  usePluginLicences, useBuyPluginForBots, useRemoveLicence,
  type LicencedPlugin, type LicenceBot,
} from "@/hooks/use-plugin-licences";

// P51: a light entrance stagger for the three plugin grids below, so the
// library doesn't just snap into place the way a static list does elsewhere
// in the app. Safe to leave unconditional — MotionConfig at the app root
// (Phase 50) already turns this off for prefers-reduced-motion.
const GRID_CONTAINER = { show: { transition: { staggerChildren: 0.04 } } };
const GRID_ITEM = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.2 } } };

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}

/** کارت یک پلاگینِ داشته: کجا نشسته و مدیریتش. */
function OwnedCard({ plugin }: { plugin: LicencedPlugin }) {
  const t = useT("botPlugins");
  const tw = useT("botWorkspace");
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const ArrowIcon = fa ? ArrowLeft : ArrowRight;
  const { toast } = useToast();

  const remove = useRemoveLicence();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const licence = plugin.licences[0];
  const sectionKey = plugin.webSection ? SECTION_LABEL_KEYS[plugin.webSection] : undefined;
  const sectionLabel = sectionKey ? (tw[sectionKey] as string) : null;

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
 * کارت یک پلاگینِ نداشته (روی *همه‌ی* بات‌ها): قیمت، و «برای کدام بات(ها)؟».
 *
 * IRFORGE_PROMPT_V3 Phase 37 — این کارت را فقط پلاگین‌هایی می‌بینند که حداقل
 * یک باتِ بی‌این‌پلاگین دارند؛ اگر روی *بعضی* بات‌ها از قبل هست (کارتِ
 * `OwnedCard` بالا نشانش می‌دهد)، اینجا فقط بات‌های باقی‌مانده چک‌لیست
 * می‌شوند — قبلاً به‌محضِ یک خرید، این کارت کلاً ناپدید می‌شد و راهی برای
 * خریدِ همان پلاگین روی بات‌های دیگر نبود.
 */
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
  const { activeRate } = useCurrency();
  const { toast } = useToast();

  const buy = useBuyPluginForBots();
  const takenBotIds = new Set(plugin.licences.map((l) => l.botId));
  const buyableBots = bots.filter((b) => !takenBotIds.has(b.id));
  // پیش‌فرض: باتی که در آن هستیم (اگر هنوز نداردش)، وگرنه اگر فقط یک بات
  // باقی مانده همان.
  const defaultBotId = scopeBotId && !takenBotIds.has(scopeBotId)
    ? scopeBotId
    : (buyableBots.length === 1 ? buyableBots[0].id : "");
  const [selectedBotIds, setSelectedBotIds] = useState<string[]>(defaultBotId ? [defaultBotId] : []);

  const sectionKey = plugin.webSection ? SECTION_LABEL_KEYS[plugin.webSection] : undefined;
  const sectionLabel = sectionKey ? (tw[sectionKey] as string) : null;

  function toggleBot(botId: string, checked: boolean) {
    setSelectedBotIds((prev) => (checked ? [...prev, botId] : prev.filter((id) => id !== botId)));
  }

  function submitPurchase() {
    if (selectedBotIds.length === 0) return;
    const botNames = Object.fromEntries(buyableBots.map((b) => [b.id, b.name || b.id]));
    buy.mutate(
      { botIds: selectedBotIds, marketplaceItemId: plugin.marketplaceItemId, pluginId: plugin.id, botNames },
      {
        onSuccess: (results) => {
          const okCount = results.filter((r) => r.ok).length;
          setSelectedBotIds([]);
          if (okCount === 0) {
            toast({ variant: "destructive", title: t.purchaseSummaryNone, description: results[0]?.error });
          } else if (okCount < results.length) {
            toast({
              title: t.purchaseSummaryPartial.replace("{ok}", String(okCount)).replace("{total}", String(results.length)),
              description: results.filter((r) => !r.ok).map((r) => `${r.botName}: ${r.error}`).join(" · "),
            });
          } else if (okCount === 1) {
            toast({ title: plugin.isFree ? t.installed : t.purchaseDone });
          } else {
            toast({ title: plugin.isFree ? t.installed : t.purchaseSummaryAll.replace("{n}", String(okCount)) });
          }
        },
        onError: (err: any) =>
          toast({
            variant: "destructive",
            title: t.errorGeneric,
            description: errMessage(err, t.errorGeneric),
          }),
      },
    );
  }

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
        {!plugin.isFree && activeRate && (
          <p className="text-[11px] text-muted-foreground">{formatConvertedAmount(plugin.price, activeRate, lang)}</p>
        )}
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
            <p className="text-muted-foreground">
              {buyableBots.length > 1 ? t.buyForWhichBots : t.buyForWhichBot}
            </p>
            {buyableBots.length > 1 ? (
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border p-1.5">
                {buyableBots.map((bot) => (
                  <label key={bot.id} className="flex cursor-pointer items-center gap-2 rounded p-1 hover:bg-muted/50">
                    <Checkbox
                      checked={selectedBotIds.includes(bot.id)}
                      onCheckedChange={(checked) => toggleBot(bot.id, checked === true)}
                    />
                    <span className="flex-1">{bot.name || bot.id}</span>
                  </label>
                ))}
              </div>
            ) : (
              <Select value={selectedBotIds[0] ?? ""} onValueChange={(id) => setSelectedBotIds([id])}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder={t.chooseBot} />
                </SelectTrigger>
                <SelectContent>
                  {buyableBots.map((bot) => (
                    <SelectItem key={bot.id} value={bot.id}>{bot.name || bot.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              size="sm"
              className="w-full"
              disabled={selectedBotIds.length === 0 || buy.isPending}
              onClick={submitPurchase}
            >
              {buy.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <ShoppingCart className="size-3.5" />}
              {plugin.isFree ? t.install : t.buy}
              {selectedBotIds.length > 1 && ` (${selectedBotIds.length})`}
            </Button>
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
  const [search, setSearch] = useState("");

  const { owned, available } = useMemo(() => {
    const plugins = data?.plugins ?? [];
    const bots = data?.bots ?? [];
    const byName = (a: LicencedPlugin, b: LicencedPlugin) =>
      pluginName(a, lang, a.id).localeCompare(pluginName(b, lang, b.id));
    // گران‌ترها اول: پلاگین‌های اصلیِ درآمدساز باید اول دیده شوند.
    const byPrice = (a: LicencedPlugin, b: LicencedPlugin) => b.price - a.price;

    // سرچ روی عنوان و توضیحِ همان زبانِ فعال — سمت کلاینت، چون فهرست پلاگین‌ها
    // در همین یک درخواست کامل می‌آید و جدا کردنش به یک endpoint سرچ جدید
    // نیازی اضافه می‌کرد.
    const q = search.trim().toLowerCase();
    const matches = (p: LicencedPlugin) =>
      q === "" ||
      pluginName(p, lang, p.id).toLowerCase().includes(q) ||
      pluginDescription(p, lang).toLowerCase().includes(q);

    return {
      owned: plugins.filter((p) => p.owned && matches(p)).sort(byName),
      // IRFORGE_PROMPT_V3 Phase 37 — قبلاً `!p.owned` بود: به‌محضِ خریدِ یک
      // پلاگین روی *هر* باتی، برای همیشه از این بخش پنهان می‌شد، حتی وقتی
      // بات‌های دیگرت هنوز نداشتنش. حالا تا وقتی حداقل یک بات بی‌این‌پلاگین
      // هست (یا اصلاً هنوز باتی نداری) اینجا می‌ماند — `AvailableCard` خودش
      // فقط همان بات‌های باقی‌مانده را چک‌لیست می‌کند.
      available: plugins
        .filter((p) => (bots.length === 0 || p.licences.length < bots.length) && matches(p))
        .sort(byPrice),
    };
  }, [data, lang, scopeBotId, search]);

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
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.searchPlaceholder}
          className="ps-9"
        />
      </div>

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
            <motion.div className="grid gap-3 sm:grid-cols-2" initial="hidden" animate="show" variants={GRID_CONTAINER}>
              {owned.map((plugin) => (
                <motion.div key={plugin.id} variants={GRID_ITEM}>
                  <OwnedCard plugin={plugin} />
                </motion.div>
              ))}
            </motion.div>
          )}
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
          <motion.div className="grid gap-3 sm:grid-cols-2" initial="hidden" animate="show" variants={GRID_CONTAINER}>
            {available.map((plugin) => (
              <motion.div key={plugin.id} variants={GRID_ITEM}>
                <AvailableCard plugin={plugin} bots={data.bots} scopeBotId={scopeBotId} />
              </motion.div>
            ))}
          </motion.div>
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
