import { useGetDashboardStats, useGetDashboardActivity, useListBots, customFetch } from "@workspace/api-client-react";
import type { ActivityItem, ActivityItemType, Bot as BotType } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MotionCard } from "@/components/ui/motion-card";
import { Badge } from "@/components/ui/badge";
import {
  Bot, Users, MessageSquare, Activity, Plus, Wallet,
  Rocket, Blocks, UserPlus, ArrowUpCircle, Terminal,
  ArrowUpRight, ArrowDownRight, Minus, Megaphone, AlertTriangle, Clock,
  CreditCard, ArrowRight, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MotionButton } from "@/components/ui/motion-button";
import { Link } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import { useLanguage, type Lang } from "@/hooks/use-language";
import { useMotionDirection } from "@/hooks/use-motion-direction";
import { formatToman } from "@/lib/format";
import { useT, type LocaleShape } from "@/hooks/use-translation";
import { TrialWarningDialog } from "@/components/dashboard/trial-warning-dialog";
import { UpdateDialog } from "@/components/updates/UpdateDialog";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { botsNeedingAttention, type AttentionReason } from "@/lib/dashboard-attention";

// P7: map each activity type to a distinct icon (sane default for unknowns).
const ACTIVITY_ICONS: Record<ActivityItemType, LucideIcon> = {
  bot_created: Bot,
  bot_deployed: Rocket,
  plugin_installed: Blocks,
  user_joined: UserPlus,
  plan_upgraded: ArrowUpCircle,
  command_created: Terminal,
};

// P5: small colored trend indicator under a stat card.
// FIX (known bug from Phase 0 audit): `lang` prop was locked to "fa" | "en" while
// the real `Lang` type has 5 values — TS error for tr/ar/ru. Now uses the real
// `Lang` type, and the translated suffix text is passed in from the caller
// (which already has `t` from useT) instead of being computed here.
function TrendBadge({ change, lang, suffix }: { change: number; lang: Lang; suffix: string }) {
  const rounded = Math.round(change * 10) / 10;
  const flat = rounded === 0;
  const up = rounded > 0;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const color = flat ? "text-muted-foreground" : up ? "text-emerald-500" : "text-red-500";
  const abs = Math.abs(rounded).toLocaleString(lang === "fa" ? "fa-IR" : "en-US");
  return (
    <p className={`mt-1 flex items-center gap-1 text-xs ${color}`}>
      <Icon className="h-3.5 w-3.5" />
      <span className="font-medium">{abs}%</span>
      <span className="text-muted-foreground">{suffix}</span>
    </p>
  );
}

/** The reason text shown in a "needs attention" row. */
function attentionReasonText(reason: AttentionReason, bot: BotType, t: LocaleShape["dashboard"]): string {
  if (reason === "trialEndingSoon") {
    return t.attentionTrialEndingSoon.replace("{n}", String(bot.trialDaysLeft ?? 0));
  }
  return {
    expired: t.attentionExpired,
    error: t.attentionError,
    paymentRejected: t.attentionPaymentRejected,
    pendingPayment: t.attentionPendingPayment,
  }[reason];
}

type DashboardAnnouncement = { id: string; title: string; message: string; type: string; createdAt: string };

const ANNOUNCEMENT_STYLES: Record<string, string> = {
  info: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  error: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
};

// P49: "needs attention" — the one thing the old, readout-only dashboard
// never surfaced: which of your bots actually needs you to do something.
// Reuses the same warning/error color language as ANNOUNCEMENT_STYLES above.
const ATTENTION_ICONS: Record<AttentionReason, LucideIcon> = {
  expired: AlertTriangle,
  trialEndingSoon: Clock,
  error: AlertTriangle,
  paymentRejected: CreditCard,
  pendingPayment: CreditCard,
};

const ATTENTION_STYLES: Record<AttentionReason, string> = {
  expired: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  trialEndingSoon: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  error: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  paymentRejected: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  pendingPayment: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

/** Bots shown at once in the "your bots" quick-access grid before it hands off to /bots. */
const QUICK_ACCESS_BOT_LIMIT = 6;

export default function Dashboard() {
  usePrivatePageTitle(useT("pageTitles").dashboard);
  const { lang } = useLanguage();
  const t = useT("dashboard");
  const reduce = useReducedMotion();
  const dir = useMotionDirection();
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: activity, isLoading: activityLoading } = useGetDashboardActivity();
  const { data: bots } = useListBots();
  const attentionItems = botsNeedingAttention(bots ?? []);
  // R5b: surface platform announcements created in the admin panel.
  // عمداً حالت خطا ندارد: اگر این کوئری شکست بخورد نوار اعلان‌ها فقط پنهان
  // می‌ماند و هیچ توستی به کاربر نشان داده نمی‌شود — یک بنر تزئینی نباید
  // داشبورد را پر از خطا کند. (retry از queryClient گلوبال می‌آید: retry: 1.)
  const { data: announcements } = useQuery({
    queryKey: ["announcements"],
    queryFn: () => customFetch<DashboardAnnouncement[]>("/api/announcements"),
  });

  const statCards = stats
    ? [
        { label: t.totalBots, value: (stats.totalBots ?? 0).toLocaleString(lang === "fa" ? "fa-IR" : "en-US"), icon: Bot, change: stats.botsChange },
        { label: t.activeBots, value: (stats.activeBots ?? 0).toLocaleString(lang === "fa" ? "fa-IR" : "en-US"), icon: Activity, change: undefined },
        { label: t.totalUsers, value: (stats.totalUsers ?? 0).toLocaleString(lang === "fa" ? "fa-IR" : "en-US"), icon: Users, change: stats.usersChange },
        // «پیام‌های پردازش‌شده» حذف شد: منبعش (`bots.message_count`) هیچ‌جای
        // استک نوشته نمی‌شد و کارت برای همه همیشه صفر بود. جایش عددی نشسته
        // که واقعاً از شیت می‌آید.
        { label: t.activeUsersToday, value: (stats.activeUsersToday ?? 0).toLocaleString(lang === "fa" ? "fa-IR" : "en-US"), icon: MessageSquare, change: undefined },
      ]
    : [];

  // کارت درآمد فقط وقتی می‌آید که دست‌کم یک بات پلاگین کیف پول داشته باشد؛
  // سرور در غیر این صورت `null` می‌دهد. باتی که فروش ندارد نباید کارتی ببیند
  // که همیشه صفر است.
  if (stats && stats.totalRevenue != null) {
    statCards.push({
      label: t.revenue,
      value: formatToman(stats.totalRevenue, lang),
      icon: Wallet,
      change: undefined,
    });
  }

  return (
    <div className="space-y-6">
      <TrialWarningDialog />
      {/* خودش وقتی آپدیت دیده‌نشده‌ای نیست هیچ چیزی رندر نمی‌کند. */}
      <UpdateDialog />
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          {t.title}
        </h1>
        <MotionButton asChild>
          <Link href="/bots">
            <Plus className="me-2 h-4 w-4" /> {t.createBot}
          </Link>
        </MotionButton>
      </div>

      {announcements && announcements.length > 0 && (
        <div className="space-y-2">
          {announcements.map((a) => (
            <div
              key={a.id}
              className={`flex items-start gap-3 rounded-lg border p-3 ${ANNOUNCEMENT_STYLES[a.type] ?? ANNOUNCEMENT_STYLES.info}`}
            >
              <Megaphone className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{a.title}</p>
                <p className="text-sm opacity-90">{a.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* P49: the one thing a status readout never had — which of your bots
          actually needs you to act, right now, independent of whether the
          one-time trial-warning dialog above was ever seen or dismissed. */}
      {attentionItems.length > 0 && (
        <div className="space-y-2">
          {attentionItems.map(({ bot, reason }) => {
            const Icon = ATTENTION_ICONS[reason];
            const href = reason === "expired" || reason === "trialEndingSoon" ? "/buy-bot" : `/bots/${bot.id}`;
            return (
              <div
                key={bot.id}
                className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 ${ATTENTION_STYLES[reason]}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{bot.name}</p>
                  <p className="text-sm opacity-90">{attentionReasonText(reason, bot, t)}</p>
                </div>
                <Button asChild size="sm" variant="outline" className="shrink-0 bg-background/60">
                  <Link href={href}>
                    {t.attentionAction} <ArrowRight className="ms-1.5 h-3.5 w-3.5 rtl-flip" />
                  </Link>
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {statsLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="h-20" />
              <CardContent className="h-10" />
            </Card>
          ))}
        </div>
      ) : stats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {statCards.map((c) => (
            <MotionCard key={c.label}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{c.label}</CardTitle>
                <c.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{c.value}</div>
                {c.change !== undefined && <TrendBadge change={c.change} lang={lang} suffix={t.trendVsPrevious} />}
              </CardContent>
            </MotionCard>
          ))}
        </div>
      ) : null}

      {/* P49: a direct jump-off point into bot management, not just a count
          of how many exist — the missing piece that made this page a
          readout instead of a workspace. */}
      {bots && bots.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t.yourBots}</CardTitle>
            {bots.length > QUICK_ACCESS_BOT_LIMIT && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/bots">
                  {t.viewAllBots} <ArrowRight className="ms-1.5 h-3.5 w-3.5 rtl-flip" />
                </Link>
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {bots.slice(0, QUICK_ACCESS_BOT_LIMIT).map((bot) => (
                <Link
                  key={bot.id}
                  href={`/bots/${bot.id}`}
                  className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:border-primary/50 hover:bg-accent/50"
                >
                  {bot.avatar ? (
                    <img
                      src={bot.avatar}
                      alt=""
                      loading="lazy"
                      className="size-9 shrink-0 rounded-lg border border-border object-cover"
                    />
                  ) : (
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Bot className="h-4.5 w-4.5" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{bot.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {bot.username ? `@${bot.username}` : t.noUsername}
                    </p>
                  </div>
                  <Badge variant={bot.status === "active" ? "default" : "secondary"} className="shrink-0">
                    {bot.status}
                  </Badge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>{t.recentActivity}</CardTitle>
          </CardHeader>
          <CardContent>
            {activityLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 bg-muted rounded-md animate-pulse" />
                ))}
              </div>
            ) : activity && activity.length > 0 ? (
              <motion.div
                className="space-y-4"
                initial="hidden"
                animate="show"
                variants={{ show: { transition: { staggerChildren: 0.05 } } }}
              >
                {activity.map((item: ActivityItem) => {
                  const Icon = ACTIVITY_ICONS[item.type] ?? Activity;
                  return (
                    <motion.div
                      key={item.id}
                      variants={{
                        hidden: { opacity: 0, x: reduce ? 0 : dir * -12 },
                        show: { opacity: 1, x: 0, transition: { type: "spring", duration: 0.3, bounce: 0.1 } },
                      }}
                      className="flex items-center gap-3 border-b pb-4 last:border-0 last:pb-0"
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="space-y-1 min-w-0">
                        <p className="flex items-center gap-2 text-sm font-medium leading-none">
                          <span className="truncate">{item.title}</span>
                          {item.botName && (
                            <Badge variant="secondary" className="shrink-0 font-normal">{item.botName}</Badge>
                          )}
                        </p>
                        <p className="text-sm text-muted-foreground truncate">{item.description}</p>
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
            ) : (
              // P9: friendly empty state with a clear next action instead of dead gray text.
              <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Bot className="h-6 w-6" />
                </div>
                <div>
                  <p className="font-medium">
                    {t.noActivityTitle}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t.noActivityDesc}
                  </p>
                </div>
                <Button asChild size="sm">
                  <Link href="/bots">
                    <Plus className="me-2 h-4 w-4" />
                    {t.createFirstBot}
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
