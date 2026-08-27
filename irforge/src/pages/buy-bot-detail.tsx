import { useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GlowButton } from "@/components/ui/glow-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Check, ArrowLeft, ArrowRight, ShoppingCart, Settings2, Lock, Cpu, MemoryStick,
  Blocks, Loader2,
} from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";
import { pluginName, pluginDescription } from "@/lib/plugin-text";
import { useT } from "@/hooks/use-translation";
import {
  getBotTier,
  CUSTOM_MODULES,
  CUSTOM_MAX_RAM_GB,
  CUSTOM_MAX_CPU_CORES,
} from "@/lib/bot-tiers";
import { usePluginPricing, quoteCustom } from "@/hooks/use-plugin-pricing";

export default function BuyBotDetail() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { tierId } = useParams<{ tierId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { addBot } = useCart();

  const isCustom = tierId === "custom";
  const tier = !isCustom ? getBotTier(tierId) : undefined;

  const tb = useT("buyBot");
  // متن پکیج‌ها و ماژول‌ها از ترجمه‌ها، نه از `bot-tiers.ts` که فقط fa/en داشت.
  const tt = useT("botTiers");

  /** متن ترجمه‌شده‌ی همین پکیج (قیمت و منابع همچنان از `BOT_TIERS`). */
  const tierText =
    tier?.id === "silver" ? tt.silver
    : tier?.id === "gold" ? tt.gold
    : tier?.id === "diamond" ? tt.diamond
    : null;

  /** برچسب ترجمه‌شده‌ی یک ماژولِ پکیج سفارشی. */
  function moduleLabel(id: string): string {
    return (tt.modules as Record<string, string>)[id] ?? id;
  }

  // Custom package: purely visual checklist for now (no pricing/logic wired up).
  const [customSelected, setCustomSelected] = useState<Set<string>>(
    new Set(CUSTOM_MODULES.filter((m) => m.mandatory).map((m) => m.id))
  );
  // Sizing for the custom build. Capped at CUSTOM_MAX_* for self-serve; the
  // chosen values ride along on the cart item so the order carries them.
  const [customRam, setCustomRam] = useState(2);
  const [customCpu, setCustomCpu] = useState(2);

  // پلاگین‌های انتخابی — هم روی پکیج سفارشی و هم روی پکیج آماده.
  const [selectedPlugins, setSelectedPlugins] = useState<Set<string>>(new Set());

  const { data: pricing, isLoading: pricingLoading } = usePluginPricing();
  const availablePlugins = pricing?.plugins ?? [];
  const chosenPlugins = availablePlugins.filter((plugin) => selectedPlugins.has(plugin.id));
  const pluginsTotal = chosenPlugins.reduce((sum, plugin) => sum + plugin.price, 0);

  // سقفِ پلاگین رایگانِ همین پکیج (مثلاً طلایی = ۱۰ رایگان) — پولی‌ها هرگز
  // جزو این سقف نیستند، دقیقاً همان قانونی که سرور در resolvePurchasePrice
  // اجرا می‌کند (lib/pluginPricing.ts). «سفارشی» عمداً سقف ندارد.
  const freeLimit = isCustom ? Infinity : (tier?.maxPlugins ?? Infinity);
  const freeChosenCount = chosenPlugins.filter((plugin) => plugin.price <= 0).length;
  const atFreeLimit = freeChosenCount >= freeLimit;

  // سفارشی: پایه + منابع + پلاگین‌ها. آماده: قیمت ثابت پکیج + پلاگین‌ها.
  const customQuote = quoteCustom(pricing?.customBuild, customRam, customCpu, chosenPlugins);
  const packagePrice = isCustom ? customQuote.total : (tier?.price ?? 0) + pluginsTotal;

  const BackArrow = fa ? ArrowRight : ArrowLeft;
  const NextArrow = fa ? ArrowLeft : ArrowRight;

  if (!isCustom && !tier) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
        <p className="text-muted-foreground">{tb.notFound}</p>
        <Button asChild variant="outline">
          <Link href="/buy-bot">{tb.backToBuyBot}</Link>
        </Button>
      </div>
    );
  }

  function togglePlugin(id: string) {
    const plugin = availablePlugins.find((p) => p.id === id);
    setSelectedPlugins((prev) => {
      if (prev.has(id)) {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }
      // فقط انتخابِ یک پلاگینِ *رایگانِ تازه* وقتی سهمیه پر است رد می‌شود؛
      // پلاگین پولی همیشه قابل‌انتخاب است.
      if (plugin && plugin.price <= 0 && atFreeLimit) {
        toast({
          variant: "destructive",
          title: tb.freePluginLimitReached.replace("{max}", String(freeLimit)),
        });
        return prev;
      }
      return new Set(prev).add(id);
    });
  }

  function toggleModule(id: string) {
    setCustomSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleAddToCart() {
    addBot({
      name: "",
      token: "",
      description: "",
      phone: "",
      telegramId: "",
      // این عدد فقط برای نمایش در سبد است؛ مبلغی که واقعاً کم می‌شود را سرور
      // از همین `buildSpec` دوباره حساب می‌کند (lib/pluginPricing.ts).
      price: packagePrice,
      tierId: isCustom ? "custom" : tier?.id,
      tierName: isCustom ? tt.custom.name : tierText?.name,
      buildSpec: {
        tierId: isCustom ? "custom" : (tier?.id ?? ""),
        ramGb: isCustom ? customRam : undefined,
        cpuCores: isCustom ? customCpu : undefined,
        pluginIds: [...selectedPlugins],
      },
    });
    toast({
      title: tb.addedToCart,
      description: tb.addedToCartDesc,
    });
    setLocation("/bots/cart");
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ms-2">
        <Link href="/buy-bot"><BackArrow className="me-2 h-4 w-4" /> {tb.back}</Link>
      </Button>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Left: preview */}
        <Card className="lg:col-span-3 overflow-hidden">
          <div
            className={`h-2 w-full bg-gradient-to-r ${isCustom ? "from-violet-400 to-fuchsia-300" : tier!.accent}`}
          />
          <CardHeader>
            <div className="flex items-center gap-3">
              <div
                className={`flex size-12 items-center justify-center rounded-lg bg-gradient-to-br text-white ${isCustom ? "from-violet-400 to-fuchsia-300" : tier!.accent}`}
              >
                {isCustom ? <Settings2 className="size-6" /> : (() => { const Icon = tier!.icon; return <Icon className="size-6" />; })()}
              </div>
              <div>
                <CardTitle className="text-2xl">{isCustom ? tt.custom.name : tierText?.name}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {isCustom ? tt.custom.tagline : tierText?.tagline}
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {!isCustom && (
              <>
                <div className="flex items-baseline gap-2 text-3xl font-extrabold">
                  {formatToman(tier!.price, lang)}
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-md border p-3">
                    <p className="text-muted-foreground">{tb.botsCount}</p>
                    <p className="font-semibold">{tier!.maxBots}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-muted-foreground">{tb.pluginsCount}</p>
                    <p className="font-semibold">{tier!.maxPlugins >= 999 ? tb.unlimited : tier!.maxPlugins}</p>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium">{tb.whatsIncluded}</p>
                  <ul className="space-y-2.5 text-sm">
                    {(tierText?.features ?? []).map((f: string) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            {isCustom && (
              <div>
                {/* Self-serve sizing is capped at CUSTOM_MAX_* — anything
                    larger is a bespoke plan an admin creates, where no cap
                    applies. */}
                <p className="mb-3 text-sm font-medium">{tb.customResources}</p>
                <div className="mb-6 space-y-5 rounded-md border p-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5">
                        <MemoryStick className="size-4 text-primary" /> {tb.ram}
                      </span>
                      <span className="font-semibold" dir="ltr">
                        {customRam} {tb.gb}
                      </span>
                    </div>
                    <Slider
                      value={[customRam]}
                      min={1}
                      max={CUSTOM_MAX_RAM_GB}
                      step={1}
                      onValueChange={([v]) => setCustomRam(v)}
                      aria-label={tb.ram}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5">
                        <Cpu className="size-4 text-primary" /> {tb.cpu}
                      </span>
                      <span className="font-semibold" dir="ltr">
                        {customCpu} {tb.cores}
                      </span>
                    </div>
                    <Slider
                      value={[customCpu]}
                      min={1}
                      max={CUSTOM_MAX_CPU_CORES}
                      step={1}
                      onValueChange={([v]) => setCustomCpu(v)}
                      aria-label={tb.cpu}
                    />
                  </div>
                </div>

                <p className="mb-3 text-sm font-medium">
                  {tb.chooseParts}
                </p>
                <div className="space-y-2">
                  {CUSTOM_MODULES.map((m) => (
                    <label
                      key={m.id}
                      className={`flex items-center gap-3 rounded-md border p-3 text-sm ${m.mandatory ? "bg-muted/50" : "cursor-pointer hover:border-primary"}`}
                    >
                      <Checkbox
                        checked={customSelected.has(m.id)}
                        disabled={m.mandatory}
                        onCheckedChange={() => toggleModule(m.id)}
                      />
                      <span className="flex-1">{moduleLabel(m.id)}</span>
                      {m.mandatory ? (
                        <Badge variant="secondary" className="flex items-center gap-1">
                          <Lock className="size-3" /> {tb.required}
                        </Badge>
                      ) : null}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* ── پلاگین‌ها ────────────────────────────────────────────────
                روی هر دو حالت (سفارشی و پکیج آماده) نشان داده می‌شود: پلاگین
                یک افزودنی است، نه چیزی که فقط سفارشی‌ها بتوانند بگیرند. */}
            <Separator />
            <div>
              <p className="mb-1 flex items-center gap-2 text-sm font-medium">
                <Blocks className="size-4 text-primary" />
                {tb.plugins}
              </p>
              <p className="mb-1 text-xs text-muted-foreground">{tb.pluginsAddonNote}</p>
              {Number.isFinite(freeLimit) && (
                <p className={`mb-3 text-xs font-medium ${atFreeLimit ? "text-amber-500" : "text-muted-foreground"}`}>
                  {tb.freePluginQuota.replace("{used}", String(freeChosenCount)).replace("{max}", String(freeLimit))}
                </p>
              )}

              {pricingLoading ? (
                <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {tb.loadingPlugins}
                </div>
              ) : availablePlugins.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
                  {tb.pluginListUnavailable}
                </p>
              ) : (
                <div className="space-y-2">
                  {availablePlugins.map((plugin) => {
                    const checked = selectedPlugins.has(plugin.id);
                    const lockedFree = !checked && plugin.price <= 0 && atFreeLimit;
                    return (
                      <label
                        key={plugin.id}
                        title={lockedFree ? tb.freePluginLimitReached.replace("{max}", String(freeLimit)) : undefined}
                        className={`flex items-start gap-3 rounded-md border p-3 text-sm transition-colors ${checked ? "border-primary bg-primary/5" : lockedFree ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-primary"}`}
                      >
                        <Checkbox
                          className="mt-0.5"
                          checked={checked}
                          disabled={lockedFree}
                          onCheckedChange={() => togglePlugin(plugin.id)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{pluginName(plugin, lang, plugin.id)}</span>
                          {pluginDescription(plugin, lang) && (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {pluginDescription(plugin, lang)}
                            </span>
                          )}
                        </span>
                        <Badge variant={plugin.price > 0 ? "secondary" : "outline"} className="shrink-0">
                          {plugin.price > 0 ? formatToman(plugin.price, lang) : tb.free}
                        </Badge>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Right: add to cart */}
        <Card className="lg:col-span-2 h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShoppingCart className="size-5 text-primary" /> {tb.addToCart}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {tb.cartNote}
            </p>

            <Separator />

            {/* صورت‌حساب زنده — با هر تیک و هر حرکت اسلایدر عوض می‌شود. */}
            <div className="space-y-2 text-sm">
              {isCustom ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{tb.base}</span>
                    <span>{formatToman(customQuote.base, lang)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {tb.resources}
                      <span className="ms-1 text-xs" dir="ltr">
                        ({customRam}GB / {customCpu} {tb.coresShort})
                      </span>
                    </span>
                    <span>
                      {customQuote.resources > 0
                        ? formatToman(customQuote.resources, lang)
                        : tb.includedInBase}
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{tb.packagePrice}</span>
                  <span>{formatToman(tier!.price, lang)}</span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {tb.plugins}
                  {chosenPlugins.length > 0 && (
                    <span className="ms-1 text-xs">({chosenPlugins.length})</span>
                  )}
                </span>
                <span>
                  {pluginsTotal > 0
                    ? formatToman(pluginsTotal, lang)
                    : tb.noneSelected}
                </span>
              </div>

              {/* فهرست ریز پلاگین‌های انتخابی، تا کاربر ببیند پول برای چه می‌دهد. */}
              {chosenPlugins.length > 0 && (
                <ul className="space-y-1 border-s ps-3 text-xs text-muted-foreground">
                  {chosenPlugins.map((plugin) => (
                    <li key={plugin.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{pluginName(plugin, lang, plugin.id)}</span>
                      <span className="shrink-0">
                        {plugin.price > 0 ? formatToman(plugin.price, lang) : tb.free}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <Separator />
              <div className="flex items-baseline justify-between">
                <span className="font-medium">{tb.total}</span>
                <span className="text-xl font-extrabold">{formatToman(packagePrice, lang)}</span>
              </div>
            </div>

            <GlowButton className="w-full" wrapperClassName="w-full" onClick={handleAddToCart}>
              <ShoppingCart className="me-2 h-4 w-4" />
              {tb.addToCart}
            </GlowButton>
            <p className="text-center text-xs text-muted-foreground">
              {tb.checkoutNote}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
