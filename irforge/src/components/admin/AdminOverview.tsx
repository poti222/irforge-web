import { useAdminGetStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Bot, Activity, UserPlus, Package, Wallet } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";

/**
 * `showRevenue` gates money figures. The stats endpoint itself is
 * `requireAdmin`, so a plain admin can load this panel — but revenue is
 * super-admin information, so the total-revenue card and the monthly revenue
 * chart are withheld from them.
 */
export function AdminOverview({ showRevenue = true }: { showRevenue?: boolean }) {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { data: stats, isLoading } = useAdminGetStats();
  const breakdown = stats?.revenueBreakdown ?? { bots: 0, plugins: 0, other: 0 };
  const nf = (n: number) => n.toLocaleString(fa ? "fa-IR" : "en-US");

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-24 animate-pulse rounded-md bg-muted" />)}
      </div>
    );
  }
  if (!stats) return null;

  // «کل پیام‌ها» حذف شد: منبعش `bots.message_count` بود، ستونی که هیچ‌جای این
  // استک نوشته نمی‌شود — پس برای همیشه و برای همه صفر بود. کارت داشبورد
  // کاربر هم به همین دلیل قبلاً حذف شده بود.
  const cards = [
    { label: fa ? "کل کاربران" : "Total Users", value: nf(stats.totalUsers), icon: Users },
    { label: fa ? "کاربران فعال" : "Active Users", value: nf(stats.activeUsers), icon: Activity },
    { label: fa ? "کاربران جدید امروز" : "New Users Today", value: nf(stats.newUsersToday), icon: UserPlus },
    { label: fa ? "کل ربات‌ها" : "Total Bots", value: nf(stats.totalBots), icon: Bot },
    ...(showRevenue
      ? [
          { label: fa ? "درآمد کل" : "Total Revenue", value: formatToman(stats.totalRevenue, lang), icon: Wallet },
          // تفکیک، چون سؤال واقعی «از فروش بات چقدر درآمد داشتم» است و یک
          // عدد کل جوابش را نمی‌دهد.
          { label: fa ? "درآمد فروش ربات" : "Bot sales", value: formatToman(breakdown.bots, lang), icon: Bot },
          { label: fa ? "درآمد پلاگین" : "Plugin sales", value: formatToman(breakdown.plugins, lang), icon: Package },
        ]
      : []),
  ];

  const revenue = showRevenue ? stats.revenueByMonth ?? [] : [];
  const plans = stats.planBreakdown ?? [];
  const subscribers = plans.reduce((acc, p) => acc + (p.count ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{c.label}</CardTitle>
              <c.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{c.value}</div></CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {revenue.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{fa ? "درآمد ماهانه" : "Revenue by month"}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revenue} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number) => formatToman(v, lang)}
                    />
                    <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/*
          همیشه رندر می‌شود، حتی وقتی هیچ‌کس مشترک نشده — «هیچ پلنی تعریف
          نشده» و «پلن‌ها هستند ولی مشترکی ندارند» دو خبر متفاوت‌اند، و
          پنهان‌کردن کارت هر دو را به یک سکوت تبدیل می‌کرد.
        */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{fa ? "توزیع پلن‌ها" : "Plan breakdown"}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {fa
                ? `${nf(subscribers)} اشتراک فعال روی ${nf(plans.length)} پلن`
                : `${nf(subscribers)} active subscriptions across ${nf(plans.length)} plans`}
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {plans.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {fa ? "هنوز پلنی تعریف نشده. از تب «پلن‌ها» بسازید." : "No plans defined yet. Create one in the Plans tab."}
              </p>
            ) : (
              plans.map((p) => (
                <div key={p.planId ?? p.plan} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <span className="block truncate">{p.plan}</span>
                    {showRevenue && (
                      <span className="text-xs text-muted-foreground">{formatToman(p.price ?? 0, lang)}</span>
                    )}
                  </div>
                  <span className="shrink-0 font-medium tabular-nums">{nf(p.count)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
