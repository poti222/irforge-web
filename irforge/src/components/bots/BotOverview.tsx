import type { LucideIcon } from "lucide-react";
import { Activity, ArrowUpRight, Blocks, Terminal, Users } from "lucide-react";
import type { Bot, BotStats } from "@workspace/api-client-react";
import { StatTile } from "@/components/forge-ui/StatTile";
import { useT } from "@/hooks/use-translation";
import { BotIdentityCard } from "@/components/bots/BotIdentityCard";
import { BotHealthCard } from "@/components/bots/BotHealthCard";
import { BotPlanCard } from "@/components/bots/BotPlanCard";
import { BotAdminCodeCard } from "@/components/bots/BotAdminCodeCard";
import { TutorialLinksCallout } from "@/components/bots/TutorialLinksCallout";

export type QuickAction = { key: string; icon: LucideIcon; label: string };

/**
 * The workspace landing view: four numbers, four one-tap shortcuts, then the
 * cards that need attention (health) or hold reference info (identity, plan,
 * admin code). Same cards as before — only the arrangement changed, so the
 * glanceable things come first and the setup chores sit to the side.
 */
export function BotOverview({
  bot,
  stats,
  nf,
  actions,
  onGo,
}: {
  bot: Bot;
  stats: BotStats | undefined;
  nf: (n: number | undefined) => string;
  actions: QuickAction[];
  onGo: (key: string) => void;
}) {
  const t = useT("botWorkspace");
  const usersSpark = stats?.activeUsersPerDay?.map((d) => d.count);

  return (
    <div className="space-y-5">
      <TutorialLinksCallout />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* شمارش کاربران از endpoint آمار می‌آید، نه از `bot.userCount`:
            آن ستون در Postgres است و هیچ‌وقت به‌روز نمی‌شد. تا رسیدن
            پاسخ، همان عدد قدیمی نشان داده می‌شود تا کارت نپرد. */}
        <StatTile label={t.overviewTotalUsers} value={nf(stats?.users ?? bot.userCount)} icon={Users} spark={usersSpark} />
        <StatTile
          label={t.overviewActiveToday}
          value={stats?.activeUsersToday == null ? "—" : nf(stats.activeUsersToday)}
          hint={stats?.activeUsersToday == null ? t.noDataYet : undefined}
          icon={Activity}
        />
        <StatTile label={t.overviewCommands} value={nf(bot.commandCount)} icon={Terminal} />
        <StatTile label={t.overviewPlugins} value={nf(bot.pluginCount)} icon={Blocks} />
      </div>

      {actions.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => onGo(a.key)}
              className="group flex items-center gap-2.5 rounded-2xl border border-border/70 bg-card px-3 py-3 text-start sm:gap-3 sm:px-4 shadow-[var(--shadow-card)] transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[var(--shadow-pop)]"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <a.icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{a.label}</span>
              <ArrowUpRight className="hidden size-4 shrink-0 text-muted-foreground sm:block transition-transform group-hover:text-primary rtl:-scale-x-100" />
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-5">
        <div className="space-y-5 xl:col-span-3">
          {/* فاز ۲۴ — سلامت بات: شکست‌های بی‌صدا را قبل از اینکه کاربرِ
              بات به آن‌ها بخورد نشان می‌دهد. */}
          <BotHealthCard bot={bot} />
          <BotIdentityCard bot={bot} />
        </div>
        <div className="space-y-5 xl:col-span-2">
          {/* فاز ۳۲ — پلن و اشتراک: پلنِ فعلی، قیمت، و روزهای باقی‌مانده. */}
          <BotPlanCard bot={bot} />
          <BotAdminCodeCard bot={bot} />
        </div>
      </div>
    </div>
  );
}
