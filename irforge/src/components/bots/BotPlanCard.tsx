/**
 * BotPlanCard.tsx — «پلن و اشتراک» در سکشن نمای کلی (فاز ۳۲).
 *
 * فقط نمایش است: پلنِ فعلی، قیمت، وضعیت، و روزهای باقی‌مانده تا تمدید —
 * خواندنی از همان جدول‌هایی که `bot/utils/subscriptions.py` (bot-side) و
 * `lib/botSubscriptions.ts` (این خلاصه) هر دو رویشان کار می‌کنند. تغییرِ
 * واقعیِ پلن (ارتقا/تمدید/کاهش) یک فازِ جداست؛ اینجا فقط دکمه‌ای به صفحه‌ی
 * قیمت‌گذاری می‌دهد.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { Loader2, Crown, ArrowUpCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";

type SubscriptionSummary = {
  planId: string;
  planName: string;
  priceMonthly: number;
  status: string;
  currentPeriodEnd: string | null;
  inGrace: boolean;
  daysRemaining: number | null;
};

function statusVariant(status: string, inGrace: boolean): "default" | "secondary" | "destructive" {
  if (inGrace) return "secondary";
  if (status === "active") return "default";
  return "destructive";
}

export function BotPlanCard({ bot }: { bot: Bot }) {
  const t = useT("botPlan");
  const { lang } = useLanguage();

  const { data, isLoading, error } = useQuery({
    queryKey: ["bot-subscription", bot.id],
    queryFn: () => customFetch<SubscriptionSummary>(`/api/bots/${bot.id}/subscription`),
    // یک بات بدون شیت ۴۰۹ می‌دهد؛ کارت به‌جای خطا فقط پنهان می‌شود
    // (دقیقاً همان رفتارِ BotHealthCard.tsx).
    retry: false,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t.loading}
        </CardContent>
      </Card>
    );
  }
  if (error || !data) return null;

  const statusLabel =
    data.inGrace ? t.statusGrace
    : data.status === "active" ? t.statusActive
    : data.status === "past_due" ? t.statusPastDue
    : data.status === "canceled" ? t.statusCanceled
    : data.status;

  return (
    <Card className={data.inGrace || data.status !== "active" ? "border-amber-500/40" : undefined}>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Crown className="size-4 text-amber-500" />
          {t.title}
          <Badge variant={statusVariant(data.status, data.inGrace)}>{statusLabel}</Badge>
          <Button variant="outline" size="sm" className="ms-auto" asChild>
            <Link href="/pricing">
              <ArrowUpCircle className="me-1.5 size-4" /> {t.upgradeCta}
            </Link>
          </Button>
        </CardTitle>
        <CardDescription>
          {data.planName}
          {data.priceMonthly > 0 && (
            <> · {t.priceMonthly.replace("{price}", formatToman(data.priceMonthly, lang))}</>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-2">
        {data.daysRemaining != null && (
          <p className="text-sm text-muted-foreground">
            {data.daysRemaining >= 0
              ? t.daysRemaining.replace("{n}", String(data.daysRemaining))
              : t.expired}
          </p>
        )}
        {data.inGrace && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <span>{t.graceWarning}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
