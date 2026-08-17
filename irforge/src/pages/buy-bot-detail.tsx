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

  // سفارشی: پایه + منابع + پلاگین‌ها. آماده: قیمت ثابت پکیج + پلاگین‌ها.
  const customQuote = quoteCustom(pricing?.customBuild, customRam, customCpu, chosenPlugins);
  const packagePrice = isCustom ? customQuote.total : (tier?.price ?? 0) + pluginsTotal;

  const BackArrow = fa ? ArrowRight : ArrowLeft;
  const NextArrow = fa ? ArrowLeft : ArrowRight;

  if (!isCustom && !tier) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
        <p className="text-muted-foreground">{fa ? "این پکیج پیدا نشد." : "Package not found."}</p>
        <Button asChild variant="outline">
          <Link href="/buy-bot">{fa ? "بازگشت به خرید بات" : "Back to Buy Bot"}</Link>
        </Button>
      </div>
    );
  }

  function togglePlugin(id: string) {
    setSelectedPlugins((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
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
      tierName: isCustom ? (fa ? "سفارشی" : "Custom") : (fa ? tier?.name.fa : tier?.name.en),
      buildSpec: {
        tierId: isCustom ? "custom" : (tier?.id ?? ""),
        ramGb: isCustom ? customRam : undefined,
        cpuCores: isCustom ? customCpu : undefined,
        pluginIds: [...selectedPlugins],
      },
    });
    toast({
      title: fa ? "به سبد خرید اضافه شد" : "Added to cart",
      description: fa ? "حالا مشخصات بات را در صفحه‌ی تسویه‌حساب کامل کن." : "Now fill in the bot's details on the checkout page.",
    });
    setLocation("/bots/cart");
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ms-2">
        <Link href="/buy-bot"><BackArrow className="me-2 h-4 w-4" /> {fa ? "بازگشت" : "Back"}</Link>
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
                <CardTitle className="text-2xl">{isCustom ? (fa ? "سفارشی" : "Custom") : (fa ? tier!.name.fa : tier!.name.en)}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {isCustom
                    ? (fa ? "امکانات بات را خودت انتخاب کن" : "Choose your bot's features yourself")
                    : (fa ? tier!.tagline.fa : tier!.tagline.en)}
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
                    <p className="text-muted-foreground">{fa ? "تعداد ربات" : "Bots"}</p>
                    <p className="font-semibold">{tier!.maxBots}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-muted-foreground">{fa ? "تعداد پلاگین" : "Plugins"}</p>
                    <p className="font-semibold">{tier!.maxPlugins >= 999 ? (fa ? "نامحدود" : "Unlimited") : tier!.maxPlugins}</p>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium">{fa ? "امکانات این پکیج" : "What's included"}</p>
                  <ul className="space-y-2.5 text-sm">
                    {tier!.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>{fa ? f.fa : f.en}</span>
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
                  {fa ? "بخش‌های بات را انتخاب کن" : "Choose your bot's parts"}
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
                      <span className="flex-1">{fa ? m.name.fa : m.name.en}</span>
                      {m.mandatory ? (
                        <Badge variant="secondary" className="flex items-center gap-1">
                          <Lock className="size-3" /> {fa ? "اجباری" : "Required"}
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
                {fa ? "پلاگین‌ها" : "Plugins"}
              </p>
              <p className="mb-3 text-xs text-muted-foreground">
                {fa
                  ? "هر پلاگینی که انتخاب کنی به قیمت اضافه می‌شود و روی همین بات نصب می‌شود. بعداً هم می‌توانی از بخش پلاگین‌های همان بات اضافه کنی."
                  : "Each plugin you pick is added to the price and installed on this bot. You can also add them later from the bot's Plugins section."}
              </p>

              {pricingLoading ? (
                <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {fa ? "در حال بارگذاری پلاگین‌ها…" : "Loading plugins…"}
                </div>
              ) : availablePlugins.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
                  {fa
                    ? "فهرست پلاگین‌ها در دسترس نیست. می‌توانی بات را بخری و پلاگین‌ها را بعداً اضافه کنی."
                    : "The plugin list isn't available. You can buy the bot and add plugins later."}
                </p>
              ) : (
                <div className="space-y-2">
                  {availablePlugins.map((plugin) => {
                    const checked = selectedPlugins.has(plugin.id);
                    return (
                      <label
                        key={plugin.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors ${checked ? "border-primary bg-primary/5" : "hover:border-primary"}`}
                      >
                        <Checkbox
                          className="mt-0.5"
                          checked={checked}
                          onCheckedChange={() => togglePlugin(plugin.id)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{plugin.name}</span>
                          {plugin.description && (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {plugin.description}
                            </span>
                          )}
                        </span>
                        <Badge variant={plugin.price > 0 ? "secondary" : "outline"} className="shrink-0">
                          {plugin.price > 0 ? formatToman(plugin.price, lang) : (fa ? "رایگان" : "Free")}
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
              <ShoppingCart className="size-5 text-primary" /> {fa ? "افزودن به سبد خرید" : "Add to cart"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {fa
                ? "این پکیج به سبد خرید اضافه می‌شود. نام بات، توکن و بقیه‌ی مشخصات را در صفحه‌ی تسویه‌حساب کامل می‌کنی."
                : "This package will be added to your cart. You'll fill in the bot's name, token and other details on the checkout page."}
            </p>

            <Separator />

            {/* صورت‌حساب زنده — با هر تیک و هر حرکت اسلایدر عوض می‌شود. */}
            <div className="space-y-2 text-sm">
              {isCustom ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{fa ? "پایه" : "Base"}</span>
                    <span>{formatToman(customQuote.base, lang)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {fa ? "منابع" : "Resources"}
                      <span className="ms-1 text-xs" dir="ltr">
                        ({customRam}GB / {customCpu} {fa ? "هسته" : "cores"})
                      </span>
                    </span>
                    <span>
                      {customQuote.resources > 0
                        ? formatToman(customQuote.resources, lang)
                        : (fa ? "در قیمت پایه" : "Included")}
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{fa ? "قیمت پکیج" : "Package price"}</span>
                  <span>{formatToman(tier!.price, lang)}</span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {fa ? "پلاگین‌ها" : "Plugins"}
                  {chosenPlugins.length > 0 && (
                    <span className="ms-1 text-xs">({chosenPlugins.length})</span>
                  )}
                </span>
                <span>
                  {pluginsTotal > 0
                    ? formatToman(pluginsTotal, lang)
                    : (fa ? "انتخاب نشده" : "None selected")}
                </span>
              </div>

              {/* فهرست ریز پلاگین‌های انتخابی، تا کاربر ببیند پول برای چه می‌دهد. */}
              {chosenPlugins.length > 0 && (
                <ul className="space-y-1 border-s ps-3 text-xs text-muted-foreground">
                  {chosenPlugins.map((plugin) => (
                    <li key={plugin.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{plugin.name}</span>
                      <span className="shrink-0">
                        {plugin.price > 0 ? formatToman(plugin.price, lang) : (fa ? "رایگان" : "Free")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <Separator />
              <div className="flex items-baseline justify-between">
                <span className="font-medium">{fa ? "مجموع" : "Total"}</span>
                <span className="text-xl font-extrabold">{formatToman(packagePrice, lang)}</span>
              </div>
            </div>

            <GlowButton className="w-full" wrapperClassName="w-full" onClick={handleAddToCart}>
              <ShoppingCart className="me-2 h-4 w-4" />
              {fa ? "افزودن به سبد خرید" : "Add to cart"}
            </GlowButton>
            <p className="text-center text-xs text-muted-foreground">
              {fa
                ? "خرید نهایی از صفحه‌ی تسویه‌حساب انجام می‌شود."
                : "Checkout is completed on the checkout page."}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
