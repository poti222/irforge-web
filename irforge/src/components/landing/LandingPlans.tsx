/**
 * LandingPlans.tsx — پلن‌ها روی صفحه‌ی اصلی، با قیمت واقعی.
 *
 * تا امروز قیمت‌ها فقط پشت لاگین بودند (`/buy-bot`) و صفحه‌ی `/pricing` هم صریحاً
 * می‌گفت «عدد نمی‌گوییم». یعنی بازدیدکننده‌ی تازه باید ثبت‌نام می‌کرد تا بفهمد
 * چقدر باید بدهد. حالا همان سه پکیج، با همان قیمت‌های `BOT_TIERS` (که سرور هم
 * در `pluginPricing.ts` از رویشان قیمت می‌گیرد، پس دو عدد متفاوت نمی‌شود)،
 * روی صفحه‌ی اصلی‌اند و هر کارت به همان صفحه‌ی خرید در داشبورد لینک است.
 *
 * متن پلن‌ها از فایل‌های ترجمه می‌آید، نه از `bot-tiers.ts` که فقط fa/en داشت —
 * وگرنه بازدیدکننده‌ی عربی/ترکی/روسی همین بخش را انگلیسی می‌دید.
 */
import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Cpu, MemoryStick, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BOT_TIERS, type BotTier } from "@/lib/bot-tiers";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";
import { RevealItem, VIEWPORT_ONCE, revealContainer, revealItem } from "@/components/landing/motion";

export function LandingPlans({ reduce }: { reduce: boolean }) {
  const tr = useT("landing");
  const tt = useT("botTiers");
  const tb = useT("buyBot");
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const ArrowIcon = fa ? ArrowLeft : ArrowRight;

  const container = revealContainer(reduce ? 0 : 0.08);
  const item = revealItem(reduce);

  /** متن هر پکیج از ترجمه‌ها؛ قیمت و منابع از `BOT_TIERS`. */
  function textFor(tier: BotTier) {
    switch (tier.id) {
      case "standard": return tt.standard;
      case "pro": return tt.pro;
      default: return null;
    }
  }

  return (
    <section id="plans" className="border-b bg-card/30 py-20 md:py-24">
      <div className="container mx-auto px-4">
        <motion.div variants={container} initial="hidden" whileInView="show" viewport={VIEWPORT_ONCE}>
          <RevealItem variants={item}>
            <div className="mx-auto mb-14 max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{tr.plansTitle}</h2>
              <p className="mt-3 text-muted-foreground">{tr.plansSub}</p>
            </div>
          </RevealItem>

          <div className="mx-auto grid max-w-6xl items-stretch gap-6 md:grid-cols-3">
            {BOT_TIERS.map((tier) => {
              const text = textFor(tier);
              if (!text) return null;
              const Icon = tier.icon;
              return (
                <RevealItem key={tier.id} variants={item} className="h-full">
                  <div
                    className={`relative flex h-full flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-colors ${
                      tier.popular
                        ? "border-primary/60 shadow-md md:-mt-3 md:mb-3"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div className={`h-1.5 w-full bg-gradient-to-r ${tier.accent}`} />

                    {tier.popular && (
                      <span className="absolute end-4 top-5 rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground">
                        {tt.popular}
                      </span>
                    )}

                    <div className="flex flex-1 flex-col p-6">
                      <span
                        className={`mb-4 flex size-11 items-center justify-center rounded-xl bg-gradient-to-br ${tier.accent} text-white`}
                      >
                        <Icon className="size-5" />
                      </span>

                      <h3 className="text-xl font-semibold">{text.name}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{text.tagline}</p>

                      <div className="mt-5">
                        <div className="text-3xl font-extrabold tracking-tight">
                          {formatToman(tier.price, lang)}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{tt.oneOff}</p>
                      </div>

                      {/* منابع، همان‌طور که در صفحه‌ی خرید هم نشان داده می‌شوند —
                          عددها یکی‌اند چون هر دو از `BOT_TIERS` می‌آیند. */}
                      <div className="mt-5 flex flex-wrap gap-2 text-xs">
                        <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1">
                          <MemoryStick className="size-3.5 text-primary" />
                          {tier.ramGb} {tb.gb}
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1">
                          <Cpu className="size-3.5 text-primary" />
                          {tier.cpuCores} {tb.cores}
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1">
                          <Users className="size-3.5 text-primary" />
                          {tier.maxConcurrentUsers.toLocaleString(fa ? "fa-IR" : "en-US")}
                        </span>
                      </div>

                      {/* همه‌ی امکانات، بدون «+۳ مورد دیگر» — فهرست نصفه دقیقاً
                          همان چیزی است که آدم را از صفحه بیرون می‌برد. */}
                      <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                        {text.features.map((feature: string) => (
                          <li key={feature} className="flex items-start gap-2">
                            <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>

                      <Button
                        asChild
                        className="mt-6 w-full"
                        variant={tier.popular ? "default" : "secondary"}
                      >
                        {/* NOTE [a11y]: all three cards render the same visible
                            label ("انتخاب همین پلن") but point at different
                            plans, so a screen-reader user tabbing the page hears
                            the same link three times with no way to tell them
                            apart — Lighthouse flags it as "Identical links have
                            the same purpose". aria-label overrides the accessible
                            name with the plan it actually leads to, while the
                            visible button text stays short. */}
                        <Link
                          href={`/buy-bot/${tier.id}`}
                          aria-label={`${tt.choose} — ${text.name}`}
                          data-testid={`link-plan-${tier.id}`}
                        >
                          {tt.choose} <ArrowIcon className="ms-2 size-4" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                </RevealItem>
              );
            })}
          </div>

          {/* پکیج سفارشی فعلاً موقتاً غیرفعال است — نه فقط اینجا، buy-bot.tsx
              و buy-bot-detail.tsx هم همین را رعایت می‌کنند. */}

          <RevealItem variants={item}>
            <p className="mx-auto mt-6 max-w-3xl text-center text-xs text-muted-foreground">
              {tr.plansNote}{" "}
              <Link href="/buy-bot" className="text-primary hover:underline" data-testid="link-plans-all">
                {tt.allPlans}
              </Link>
            </p>
          </RevealItem>
        </motion.div>
      </div>
    </section>
  );
}
