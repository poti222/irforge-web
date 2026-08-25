import { useState } from "react";
import { useAdminGetStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Bot, Activity, UserPlus, Package, Wallet } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";
import { RevenueDrilldown, type RevenueDrilldownFilter } from "@/components/admin/RevenueDrilldown";

/**
 * `showRevenue` gates money figures. The stats endpoint itself is
 * `requireAdmin`, so a plain admin can load this panel — but revenue is
 * super-admin information, so the total-revenue card and the monthly revenue
 * chart are withheld from them. The drill-down dialog is gated the same way
 * by construction: it only ever opens from a card/bar that `showRevenue`
 * itself already hid, and its endpoint is `requireSuperAdmin` regardless.
 */
export function AdminOverview({ showRevenue = true }: { showRevenue?: boolean }) {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { data: stats, isLoading } = useAdminGetStats();
  const breakdown = stats?.revenueBreakdown ?? { bots: 0, plugins: 0, other: 0 };
  const nf = (n: number) => n.toLocaleString(fa ? "fa-IR" : "en-US");
  const [drilldown, setDrilldown] = useState<RevenueDrilldownFilter>(null);

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
  //
  // `onClick` فقط روی کارت‌های پول است — تعداد کاربر/بات «درآمد» نیست و
  // اندپوینتِ drill-down هم چیزی برایشان ندارد.
  const cards: Array<{ label: string; value: string; icon: typeof Users; onClick?: () => void }> = [
    { label: fa ? "کل کاربران" : "Total Users", value: nf(stats.totalUsers), icon: Users },
    { label: fa ? "کاربران فعال" : "Active Users", value: nf(stats.activeUsers), icon: Activity },
    { label: fa ? "کاربران جدید امروز" : "New Users Today", value: nf(stats.newUsersToday), icon: UserPlus },
    { label: fa ? "کل ربات‌ها" : "Total Bots", value: nf(stats.totalBots), icon: Bot },
    ...(showRevenue
      ? [
          {
            label: fa ? "درآمد کل" : "Total Revenue",
            value: formatToman(stats.totalRevenue, lang),
            icon: Wallet,
            onClick: () => setDrilldown({ title: fa ? "درآمد کل" : "Total Revenue" }),
          },
          // تفکیک، چون سؤال واقعی «از فروش بات چقدر درآمد داشتم» است و یک
          // عدد کل جوابش را نمی‌دهد.
          {
            label: fa ? "درآمد فروش ربات" : "Bot sales",
            value: formatToman(breakdown.bots, lang),
            icon: Bot,
            onClick: () => setDrilldown({ kind: "bot", title: fa ? "درآمد فروش ربات" : "Bot sales" }),
          },
          {
            label: fa ? "درآمد پلاگین" : "Plugin sales",
            value: formatToman(breakdown.plugins, lang),
            icon: Package,
            onClick: () => setDrilldown({ kind: "plugin", title: fa ? "درآمد پلاگین" : "Plugin sales" }),
          },
        ]
      : []),
  ];

  // بک‌اند حالا `key` (`YYYY-MM`) هم می‌فرستد — برچسبِ نمایشیِ «Jan» برای
  // دوازده ماهِ متفاوت یکتا نیست، پس کلیک روی یک ستون از همین کلید می‌فهمد
  // کدام ماه را از drill-down بخواهد.
  const revenue = (showRevenue ? stats.revenueByMonth ?? [] : []) as Array<{ month: string; key?: string; revenue: number }>;
  const plans = stats.planBreakdown ?? [];
  const subscribers = plans.reduce((acc, p) => acc + (p.count ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card
            key={c.label}
            onClick={c.onClick}
            className={c.onClick ? "cursor-pointer transition-colors hover:border-primary/50" : undefined}
            role={c.onClick ? "button" : undefined}
            tabIndex={c.onClick ? 0 : undefined}
            onKeyDown={c.onClick ? (e) => (e.key === "Enter" || e.key === " ") && c.onClick!() : undefined}
          >
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
              <p className="text-xs text-muted-foreground">
                {fa ? "برای دیدن جزئیاتِ یک ماه، روی ستونش کلیک کنید." : "Click a bar to see that month's transactions."}
              </p>
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
                    <Bar
                      dataKey="revenue"
                      fill="hsl(var(--primary))"
                      radius={[4, 4, 0, 0]}
                      cursor="pointer"
                      onClick={(entry: any) =>
                        setDrilldown({
                          month: entry?.key,
                          title: fa ? `درآمد ${entry?.month}` : `Revenue — ${entry?.month}`,
                        })
                      }
                    >
                      {revenue.map((r) => <Cell key={r.key ?? r.month} />)}
                    </Bar>
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

      <RevenueDrilldown filter={drilldown} onClose={() => setDrilldown(null)} />
    </div>
  );
}
