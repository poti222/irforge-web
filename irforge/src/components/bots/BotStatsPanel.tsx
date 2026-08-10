import { useGetBotStats, getGetBotStatsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshButton } from "@/components/ui/refresh-button";
import { UserCheck, Users, Terminal, Blocks } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";

export function BotStatsPanel({ botId, status }: { botId: string; status: string }) {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const tb = useT("bots");
  const tw = useT("botWorkspace");
  const isLive = status === "active";

  // Y5: poll while the bot is live so the numbers visibly tick up.
  const { data: stats, isLoading } = useGetBotStats(botId, {
    query: {
      queryKey: getGetBotStatsQueryKey(botId),
      refetchInterval: isLive ? 5000 : false,
    },
  });

  const nf = (n: number) => n.toLocaleString(fa ? "fa-IR" : "en-US");

  // "Messages" is replaced by active users here and in the chart below: a raw
  // message count says how chatty the bot is, not how many people it reached.
  const cards = stats
    ? [
        {
          label: fa ? "کاربران فعال امروز" : "Active users today",
          // TODO: backend field — no per-user activity data exists yet, so this
          // shows a dash rather than a made-up figure.
          value: stats.activeUsersToday == null ? "—" : nf(stats.activeUsersToday),
          icon: UserCheck,
        },
        { label: fa ? "کاربران" : "Users", value: nf(stats.users), icon: Users },
        { label: fa ? "دستورات" : "Commands", value: nf(stats.commands), icon: Terminal },
        { label: fa ? "پلاگین‌ها" : "Plugins", value: nf(stats.plugins), icon: Blocks },
      ]
    : [];

  const series = stats?.activeUsersPerDay ?? [];

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 animate-pulse rounded-md bg-muted" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            {isLive && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            )}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${isLive ? "bg-emerald-500" : "bg-muted-foreground"}`} />
          </span>
          <span className="text-sm text-muted-foreground">
            {isLive ? (fa ? "زنده" : "Live") : (fa ? "غیرفعال" : "Offline")}
            {stats && ` · ${fa ? "آپ‌تایم" : "uptime"} ${stats.uptime}%`}
          </span>
        </div>
        <RefreshButton
          className="shrink-0"
          queryKeys={[getGetBotStatsQueryKey(botId)]}
          label={fa ? "به‌روزرسانی آمار" : "Refresh stats"}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{tb.activeUsersDaily}</CardTitle>
        </CardHeader>
        <CardContent>
          {series.length === 0 ? (
            // Explicit empty state rather than hiding the card: the chart is
            // part of the spec, and silently omitting it would read as a bug.
            // TODO: backend field — activeUsersPerDay is not returned yet.
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              {tw.noDataYet}
            </div>
          ) : (
            <div className="h-64 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                    tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: "hsl(var(--foreground))" }}
                  />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
