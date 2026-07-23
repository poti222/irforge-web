import { useAdminGetStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Bot, Activity, UserPlus, MessageSquare, Wallet } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";

export function AdminOverview() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { data: stats, isLoading } = useAdminGetStats();
  const nf = (n: number) => n.toLocaleString(fa ? "fa-IR" : "en-US");

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-24 animate-pulse rounded-md bg-muted" />)}
      </div>
    );
  }
  if (!stats) return null;

  const cards = [
    { label: fa ? "کل کاربران" : "Total Users", value: nf(stats.totalUsers), icon: Users },
    { label: fa ? "کاربران فعال" : "Active Users", value: nf(stats.activeUsers), icon: Activity },
    { label: fa ? "کاربران جدید امروز" : "New Users Today", value: nf(stats.newUsersToday), icon: UserPlus },
    { label: fa ? "کل ربات‌ها" : "Total Bots", value: nf(stats.totalBots), icon: Bot },
    { label: fa ? "کل پیام‌ها" : "Total Messages", value: nf(stats.totalMessages), icon: MessageSquare },
    { label: fa ? "درآمد کل" : "Total Revenue", value: formatToman(stats.totalRevenue, lang), icon: Wallet },
  ];

  const revenue = stats.revenueByMonth ?? [];
  const plans = stats.planBreakdown ?? [];

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

        {plans.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{fa ? "توزیع پلن‌ها" : "Plan breakdown"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {plans.map((p) => (
                <div key={p.plan} className="flex items-center justify-between text-sm">
                  <span className="capitalize text-muted-foreground">{p.plan}</span>
                  <span className="font-medium">{nf(p.count)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
