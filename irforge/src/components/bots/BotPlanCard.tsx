/**
 * BotPlanCard.tsx — «پلن و اشتراک» در سکشن نمای کلی.
 *
 * تا امروز این کارت از `GET /api/bots/:botId/subscription` می‌خواند — که
 * `lib/botSubscriptions.ts` را صدا می‌زند: آینه‌ی سیستم داخلیِ خودِ بات برای
 * پلن‌های bronze/silver/gold/diamond که **صاحبِ بات به مشتری‌های تلگرامیِ
 * خودش** می‌فروشد (پلاگین subscription). آن سیستم کاملاً جداست و نباید
 * دست بخورد — ولی این کارت درست همان اطلاعات را با برچسبِ عمومیِ «پلن و
 * اشتراک» نشان می‌داد، یعنی کاربری که بات خودش را باز می‌کرد به‌جای دیدنِ
 * پکیجِ خودش (استاندارد/پرو، همان چیزی که برای همین بات پول داده)، تنظیماتِ
 * پلاگینِ اشتراکِ مشتری‌هایش را می‌دید — گزارش شد به‌عنوان «نمی‌گوید استاندارد
 * یا پرو».
 *
 * درست: پکیجِ خریداری‌شده‌ی همین بات (`bot.tier`، ستونی که سرور موقع خرید
 * ثبت می‌کند — `routes/bots.ts`)، به‌علاوه‌ی روزهای باقی‌مانده‌ی تریال اگر
 * تریالی است، به‌علاوه‌ی دکمه‌ی ارتقا برای استاندارد → پرو.
 *
 * IRFORGE_MONTHLY_TIER_EXPIRY_PROMPT — استاندارد/پرو دیگر خریدِ همیشگی نیست:
 * هر ماه با `tierExpiresAt` تمام می‌شود. اینجا هم مثلِ تریال یک شمارش‌معکوس
 * نشان می‌دهد، ولی با دکمه‌ی «تمدید» (`POST .../renew`، شارژِ دستیِ کیف‌پول)
 * چون این یکی برخلاف تریال قابلِ تمدید است. اگر status از قبل tier_expired
 * باشد (شارژِ خودکار lib/tierExpiry.ts ناموفق بوده) یک بنرِ هشدارِ قرمز به‌جای
 * شمارش‌معکوسِ معمولی نشان داده می‌شود.
 */
import { Link } from "wouter";
import type { Bot } from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Crown, ArrowUpCircle, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";
import type { BotTierId } from "@/lib/bot-tiers";

function tierName(tt: Record<string, any>, tier: BotTierId | null): string {
  if (tier === "standard") return tt.standard.name;
  if (tier === "pro") return tt.pro.name;
  if (tier === "custom") return tt.custom.name;
  return "";
}

export function BotPlanCard({ bot }: { bot: Bot }) {
  const t = useT("botPlan");
  const tt = useT("botTiers");
  const { toast } = useToast();
  const qc = useQueryClient();

  const tier = (bot.tier ?? null) as BotTierId | null;
  const label = tierName(tt, tier);

  const upgrade = useMutation({
    mutationFn: () => customFetch(`/api/bots/${bot.id}/upgrade-tier`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bots"] });
      qc.invalidateQueries({ queryKey: ["bot", bot.id] });
      toast({ title: t.upgraded });
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: t.upgradeFailed, description: err?.data?.error ?? err?.message }),
  });

  const renew = useMutation({
    mutationFn: () => customFetch(`/api/bots/${bot.id}/renew`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bots"] });
      qc.invalidateQueries({ queryKey: ["bot", bot.id] });
      toast({ title: t.renewed });
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: t.renewFailed, description: err?.data?.error ?? err?.message }),
  });

  // بات‌های بدونِ tierExpiresAt (سفارشی/خریدِ قدیمی) این بخش را اصلاً نمی‌بینند.
  const isTierExpired = bot.status === "tier_expired";
  const tierDaysLeft = bot.tierDaysLeft ?? null;
  const showTierWarning = !isTierExpired && tierDaysLeft != null && tierDaysLeft <= 3;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Crown className="size-4 text-amber-500" />
          {t.title}
          {label ? <Badge variant="secondary">{label}</Badge> : <Badge variant="outline">{t.tierUnknown}</Badge>}
          {tier === "standard" && (
            <Button
              variant="outline" size="sm" className="ms-auto gap-1.5"
              disabled={upgrade.isPending}
              onClick={() => upgrade.mutate()}
            >
              {upgrade.isPending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpCircle className="size-4" />}
              {tt.pro.name} {t.upgradeCta}
            </Button>
          )}
          {!tier && (
            <Button variant="outline" size="sm" className="ms-auto gap-1.5" asChild>
              <Link href="/products">
                <ArrowUpCircle className="size-4" /> {t.upgradeCta}
              </Link>
            </Button>
          )}
        </CardTitle>
        {tier && <CardDescription>{tt[tier]?.tagline}</CardDescription>}
      </CardHeader>

      {bot.isTrial && (
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {bot.trialDaysLeft != null && bot.trialDaysLeft >= 0
              ? t.daysRemaining.replace("{n}", String(bot.trialDaysLeft))
              : t.expired}
          </p>
        </CardContent>
      )}

      {bot.tierExpiresAt && (
        <CardContent className="flex flex-wrap items-center justify-between gap-2">
          <p className={`text-sm ${isTierExpired ? "text-destructive font-medium" : showTierWarning ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
            {isTierExpired ? (
              <span className="inline-flex items-center gap-1.5">
                <AlertTriangle className="size-4" /> {t.tierExpired}
              </span>
            ) : tierDaysLeft != null && tierDaysLeft >= 0 ? (
              t.tierDaysRemaining.replace("{n}", String(tierDaysLeft))
            ) : null}
          </p>
          {(isTierExpired || showTierWarning) && (
            <Button
              variant={isTierExpired ? "default" : "outline"} size="sm" className="gap-1.5"
              disabled={renew.isPending}
              onClick={() => renew.mutate()}
            >
              {renew.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {t.renewCta}
            </Button>
          )}
        </CardContent>
      )}
    </Card>
  );
}
