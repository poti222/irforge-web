import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bot, CheckCircle2, CreditCard, LifeBuoy, Loader2, School, Smartphone, UserPlus, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshButton } from "@/components/ui/refresh-button";
import { useLanguage } from "@/hooks/use-language";
import { AdminOverview } from "@/components/admin/AdminOverview";
import ErrorBoundary from "@/components/error-boundary";
import { SUPER_QUERY_ROOT, getSuperOverview, type SuperOverviewData } from "./superApi";
import { ATTENTION_TABS } from "./superTabs";

/**
 * components/super/SuperOverview.tsx — `/super` ← «نمای کلی»: شمارش‌هایِ زنده (GET /api/super/overview) + «نیازمندِ توجه»
 * (هر مورد به تبِ مربوط می‌پرد) + همان نمایِ کلیِ درآمدِ /admin (AdminOverview) زیرش.
 */

const KEY = [SUPER_QUERY_ROOT, "overview"] as const;

type Attention = { key: keyof SuperOverviewData["attention"]; icon: typeof CreditCard; fa: string; en: string };

/** هر مورد: چه چیزی منتظرِ تصمیمِ ادمین است؛ تبِ مقصدش در `ATTENTION_TABS` (superTabs.ts). */
export const ATTENTION_ITEMS: Attention[] = [
  { key: "pendingWalletReceipts", icon: CreditCard, fa: "فیشِ کیف‌پولِ در انتظارِ تأیید", en: "Wallet receipts awaiting approval" },
  { key: "cardPaymentsAwaitingReview", icon: Smartphone, fa: "پرداختِ کارت‌به‌کارتِ نیازمندِ بررسیِ دستی", en: "Card payments needing manual review" },
  { key: "openTickets", icon: LifeBuoy, fa: "تیکتِ باز", en: "Open tickets" },
  { key: "pendingSignups", icon: UserPlus, fa: "ثبت‌نامِ نیمه‌کاره", en: "Unfinished signups" },
  { key: "silentPaymentChannels", icon: AlertTriangle, fa: "کانالِ پرداختِ فعال که گوشی‌اش ساکت است (۱۲+ ساعت بی‌پیامک)", en: "Active payment channels with a silent phone (12h+ without SMS)" },
];

function Stat({ icon: Icon, label, value, sub, onClick, testId }: { icon: typeof Users; label: string; value: number; sub?: string; onClick?: () => void; testId: string }) {
  return (
    <button type="button" onClick={onClick} className="rounded-lg border bg-card p-4 text-start transition-colors hover:bg-accent/40" data-testid={testId}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="size-4" />{label}</div>
      <div className="mt-1 text-2xl font-bold" dir="ltr">{value.toLocaleString("en-US")}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </button>
  );
}

export function SuperOverview({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { data, isLoading, error } = useQuery({ queryKey: KEY, queryFn: getSuperOverview, refetchInterval: 60_000 });

  if (isLoading) return <div className="flex h-32 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>;
  if (error || !data) return <p className="text-sm text-destructive">{fa ? "دریافتِ نمایِ کلی ممکن نشد." : "Couldn't load the overview."}</p>;

  const open = ATTENTION_ITEMS.filter((i) => data.attention[i.key] > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="me-auto text-base font-semibold">{fa ? "وضعیتِ پلتفرم" : "Platform status"}</h2>
        <RefreshButton queryKeys={[[...KEY]]} label={fa ? "به‌روزرسانی" : "Refresh"} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat testId="ov-users" icon={Users} label={fa ? "کاربران" : "Users"} value={data.users.total} sub={fa ? `${data.users.newLast7d} نفر در ۷ روزِ اخیر` : `${data.users.newLast7d} in the last 7 days`} onClick={() => onNavigate("users")} />
        <Stat testId="ov-bots" icon={Bot} label={fa ? "ربات‌ها" : "Bots"} value={data.bots.total} sub={Object.entries(data.bots.byStatus).map(([k, v]) => `${k}: ${v}`).join(" · ")} onClick={() => onNavigate("bots")} />
        <Stat testId="ov-schools" icon={School} label={fa ? "مدارس" : "Schools"} value={data.schools.total} sub={fa ? `${data.schools.test} آزمایشی` : `${data.schools.test} test`} onClick={() => onNavigate("schools")} />
        <Stat testId="ov-members" icon={Users} label={fa ? "اعضایِ مدارس" : "School members"} value={data.schools.members} onClick={() => onNavigate("schools")} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{fa ? "نیازمندِ توجه" : "Needs attention"}</CardTitle></CardHeader>
        <CardContent>
          {open.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400" data-testid="ov-all-clear"><CheckCircle2 className="size-4" />{fa ? "همه‌چیز مرتب است؛ موردِ بازی نیست." : "All clear — nothing is waiting."}</p>
          ) : (
            <ul className="space-y-2">
              {open.map((i) => (
                <li key={i.key}>
                  <button type="button" onClick={() => onNavigate(ATTENTION_TABS[i.key])} className="flex w-full items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-start hover:bg-amber-500/10" data-testid={`ov-attn-${i.key}`}>
                    <i.icon className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span className="min-w-0 flex-1 text-sm">{fa ? i.fa : i.en}</span>
                    <Badge variant="outline" className="shrink-0" dir="ltr">{data.attention[i.key]}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* بخشِ درآمد/نمودار جدا محافظت می‌شود تا اگر خراب شد، شمارش‌ها و «نیازمندِ توجه» بالا بمانند. */}
      <ErrorBoundary inline><AdminOverview showRevenue /></ErrorBoundary>
    </div>
  );
}
