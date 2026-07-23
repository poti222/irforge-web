import { useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GlowButton } from "@/components/ui/glow-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Check, ArrowLeft, ArrowRight, ShoppingCart, Bot as BotIcon, Settings2, Lock,
} from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";
import { getBotTier, CUSTOM_MODULES } from "@/lib/bot-tiers";

export default function BuyBotDetail() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { tierId } = useParams<{ tierId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { addBot } = useCart();

  const isCustom = tierId === "custom";
  const tier = !isCustom ? getBotTier(tierId) : undefined;

  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  // Custom package: purely visual checklist for now (no pricing/logic wired up).
  const [customSelected, setCustomSelected] = useState<Set<string>>(
    new Set(CUSTOM_MODULES.filter((m) => m.mandatory).map((m) => m.id))
  );

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

  function toggleModule(id: string) {
    setCustomSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleAddToCart() {
    if (!name.trim() || !token.trim()) {
      toast({
        variant: "destructive",
        title: fa ? "نام و توکن بات الزامی است" : "Bot name and token are required",
      });
      return;
    }
    addBot({
      name: name.trim(),
      token: token.trim(),
      description: "",
      price: isCustom ? 0 : (tier?.price ?? 0),
      tierId: isCustom ? "custom" : tier?.id,
      tierName: isCustom ? (fa ? "سفارشی" : "Custom") : (fa ? tier?.name.fa : tier?.name.en),
    });
    toast({
      title: fa ? "به سبد خرید اضافه شد" : "Added to cart",
      description: fa ? "از سبد خرید بالای صفحه، خریدت را نهایی کن." : "Finish checkout from the cart at the top.",
    });
    setLocation("/bots");
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
                <p className="mt-3 text-xs text-muted-foreground">
                  {fa
                    ? "قیمت‌گذاری پکیج سفارشی به‌زودی اضافه می‌شود؛ فعلاً می‌توانی درخواستت را با تیم پشتیبانی هماهنگ کنی."
                    : "Custom pricing is coming soon; for now, coordinate your request with support."}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: purchase form */}
        <Card className="lg:col-span-2 h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <BotIcon className="size-5 text-primary" /> {fa ? "مشخصات بات" : "Bot details"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bot-name">{fa ? "نام بات *" : "Bot name *"}</Label>
              <Input
                id="bot-name"
                placeholder={fa ? "مثلاً: فروشگاه من" : "e.g. My Shop"}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bot-token">{fa ? "توکن بات *" : "Bot token *"}</Label>
              <Input
                id="bot-token"
                dir="ltr"
                placeholder="123456:ABCdef..."
                className="font-mono text-sm"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {fa ? "توکن رو از @BotFather دریافت کن" : "Get your token from @BotFather"}
              </p>
            </div>

            <Separator />

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{fa ? "قیمت پکیج" : "Package price"}</span>
              <span className="font-semibold">{isCustom ? (fa ? "بعداً مشخص می‌شود" : "TBD") : formatToman(tier!.price, lang)}</span>
            </div>

            <GlowButton className="w-full" wrapperClassName="w-full" onClick={handleAddToCart}>
              <ShoppingCart className="me-2 h-4 w-4" />
              {fa ? "افزودن به سبد خرید" : "Add to cart"}
            </GlowButton>
            <p className="text-center text-xs text-muted-foreground">
              {fa
                ? "خرید نهایی از داخل سبد خرید (بالای صفحه) انجام می‌شود."
                : "Checkout happens from the cart at the top of the page."}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
