import { useState } from "react";
import { Link } from "wouter";
import { CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { MotionCard } from "@/components/ui/motion-card";
import { Button } from "@/components/ui/button";
import { GlowButton } from "@/components/ui/glow-button";
import { Check, Settings2, ArrowLeft, ArrowRight, Gift } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { useAuth } from "@/contexts/AuthContext";
import { formatToman } from "@/lib/format";
import { BOT_TIERS } from "@/lib/bot-tiers";
import { TrialDialog } from "@/components/bots/TrialDialog";

export default function BuyBot() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { user } = useAuth();
  const ArrowIcon = fa ? ArrowLeft : ArrowRight;
  const [trialOpen, setTrialOpen] = useState(false);
  const hasUsedTrial = Boolean(user?.hasUsedTrial);

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          {fa ? "خرید بات جدید" : "Buy a New Bot"}
        </h1>
        <p className="max-w-lg text-muted-foreground">
          {fa
            ? "یکی از پکیج‌های آماده را انتخاب کن یا خودت امکانات بات را بچین."
            : "Pick one of the ready-made packages, or build your own."}
        </p>
      </div>

      {!hasUsedTrial && (
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-6 text-center sm:flex-row sm:justify-between sm:text-start">
          <div className="flex items-center gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Gift className="size-6" />
            </div>
            <div>
              <p className="font-semibold">{fa ? "۷ روز رایگان امتحان کن" : "Try it free for 7 days"}</p>
              <p className="text-sm text-muted-foreground">
                {fa
                  ? "معادل پکیج نقره‌ای، فقط با اتصال تلگرام و بدون نیاز به پرداخت."
                  : "Equivalent to the Silver package — just link Telegram, no payment needed."}
              </p>
            </div>
          </div>
          <GlowButton className="w-full sm:w-auto shrink-0" onClick={() => setTrialOpen(true)}>
            <Gift className="me-2 h-4 w-4" /> {fa ? "شروع تریال رایگان" : "Start free trial"}
          </GlowButton>
        </div>
      )}

      <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-2 lg:grid-cols-4">
        {BOT_TIERS.map((tier) => {
          const Icon = tier.icon;
          return (
            <MotionCard
              key={tier.id}
              className={`flex flex-col overflow-hidden ${tier.popular ? "border-primary shadow-md relative" : ""}`}
            >
              {tier.popular && (
                <div className="absolute top-0 right-0 z-10 translate-x-1/4 -translate-y-1/2 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
                  {fa ? "پیشنهادی" : "POPULAR"}
                </div>
              )}
              <div className={`h-1.5 w-full bg-gradient-to-r ${tier.accent}`} />
              <CardHeader>
                <div className={`mb-2 flex size-11 items-center justify-center rounded-lg bg-gradient-to-br ${tier.accent} text-white`}>
                  <Icon className="size-5" />
                </div>
                <CardTitle className="text-xl">{fa ? tier.name.fa : tier.name.en}</CardTitle>
                <p className="text-sm text-muted-foreground">{fa ? tier.tagline.fa : tier.tagline.en}</p>
                <div className="mt-3 flex items-baseline gap-1 text-2xl font-extrabold">
                  {formatToman(tier.price, lang)}
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                <ul className="space-y-2.5 text-sm">
                  {tier.features.slice(0, 4).map((f, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>{fa ? f.fa : f.en}</span>
                    </li>
                  ))}
                  {tier.features.length > 4 && (
                    <li className="text-xs text-muted-foreground">
                      {fa ? `+ ${tier.features.length - 4} امکان دیگر` : `+ ${tier.features.length - 4} more`}
                    </li>
                  )}
                </ul>
              </CardContent>
              <CardFooter>
                <Button className="w-full" variant={tier.popular ? "default" : "secondary"} asChild>
                  <Link href={`/buy-bot/${tier.id}`}>
                    {fa ? "مشاهده و انتخاب" : "View & Select"} <ArrowIcon className="ms-2 h-4 w-4" />
                  </Link>
                </Button>
              </CardFooter>
            </MotionCard>
          );
        })}

        {/* Custom package card */}
        <MotionCard className="flex flex-col overflow-hidden border-dashed">
          <div className="h-1.5 w-full bg-gradient-to-r from-violet-400 to-fuchsia-300" />
          <CardHeader>
            <div className="mb-2 flex size-11 items-center justify-center rounded-lg bg-gradient-to-br from-violet-400 to-fuchsia-300 text-white">
              <Settings2 className="size-5" />
            </div>
            <CardTitle className="text-xl">{fa ? "سفارشی" : "Custom"}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {fa ? "امکانات بات را خودت انتخاب کن" : "Choose your bot's features yourself"}
            </p>
          </CardHeader>
          <CardContent className="flex-1">
            <p className="text-sm text-muted-foreground">
              {fa
                ? "بعضی بخش‌ها همیشه فعال‌اند (اجباری) و بقیه را خودت روشن/خاموش می‌کنی."
                : "Some parts are always on (required); you toggle the rest."}
            </p>
          </CardContent>
          <CardFooter>
            <Button className="w-full" variant="outline" asChild>
              <Link href="/buy-bot/custom">
                {fa ? "ساخت پکیج سفارشی" : "Build Custom Package"} <ArrowIcon className="ms-2 h-4 w-4" />
              </Link>
            </Button>
          </CardFooter>
        </MotionCard>
      </div>

      <TrialDialog open={trialOpen} onOpenChange={setTrialOpen} />
    </div>
  );
}
