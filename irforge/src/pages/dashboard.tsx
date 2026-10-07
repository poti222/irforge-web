import { useState } from "react";
import { useGetDashboardStats, useGetDashboardActivity, useListBots, customFetch } from "@workspace/api-client-react";
import type { ActivityItem, ActivityItemType, Bot as BotType } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Bot, Users, MessageSquare, Activity, Plus, Wallet,
  Rocket, Blocks, UserPlus, ArrowUpCircle, Terminal,
  ArrowUpRight, ArrowDownRight, Minus, Megaphone, AlertTriangle, Clock,
  CreditCard, ArrowRight, Gift, X, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MotionButton } from "@/components/ui/motion-button";
import { Link } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import { useLanguage, type Lang } from "@/hooks/use-language";
import { useMotionDirection } from "@/hooks/use-motion-direction";
import { formatToman } from "@/lib/format";
import { useT, type LocaleShape } from "@/hooks/use-translation";
import { useAuth } from "@/contexts/AuthContext";
import { TrialWarningDialog } from "@/components/dashboard/trial-warning-dialog";
import { TrialDialog } from "@/components/bots/TrialDialog";
import { UpdateDialog } from "@/components/updates/UpdateDialog";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { botsNeedingAttention, type AttentionReason } from "@/lib/dashboard-attention";
import { PageHeader } from "@/components/forge-ui/PageHeader";
import { ForgePanel } from "@/components/forge-ui/ForgePanel";
import { StatTile } from "@/components/forge-ui/StatTile";
import { StatusPill } from "@/components/forge-ui/LiveDot";
import { botStatusMeta } from "@/lib/bot-status";

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
  if (reason === "tierEndingSoon") {
    return t.attentionTierEndingSoon.replace("{n}", String(bot.tierDaysLeft ?? 0));
  }
  return {
    expired: t.attentionExpired,
    tierExpired: t.attentionTierExpired,
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
  tierExpired: AlertTriangle,
  tierEndingSoon: Clock,
  error: AlertTriangle,
  paymentRejected: CreditCard,
  pendingPayment: CreditCard,
};

const ATTENTION_STYLES: Record<AttentionReason, string> = {
  expired: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  trialEndingSoon: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  tierExpired: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  tierEndingSoon: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
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
  const { user, refreshUser } = useAuth();
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: activity, isLoading: activityLoading } = useGetDashboardActivity();
  const { data: bots } = useListBots();
  const attentionItems = botsNeedingAttention(bots ?? []);

  // فاز ۱۱ (identityverificationspec.md): بنرِ پیشنهادِ تریال، فقط برای
  // کاربری که هنوز باتی نساخته، تریال نگرفته و بنر را نبسته — یک ستونِ
  // دیتابیس (نه localStorage) چون باید روی هر دستگاهی که وارد می‌شود هم
  // صدق کند. `bots` هنوز لود نشده باشد یعنی هنوز نمی‌دانیم — بنر تا لود
  // شدنش نشان داده نمی‌شود، نه اینکه با فرضِ «صفر بات» چشمک بزند.
  const [trialOpen, setTrialOpen] = useState(false);
  const [dismissingTrialOffer, setDismissingTrialOffer] = useState(false);
  const showTrialOffer = Boolean(
    bots && bots.length === 0 && user && !user.hasUsedTrial && !user.hasSeenTrialOffer,
  );

  async function dismissTrialOffer() {
    setDismissingTrialOffer(true);
    try {
      await customFetch("/api/users/trial-offer-dismissed", { method: "POST" });
      await refreshUser();
    } finally {
      setDismissingTrialOffer(false);
    }
  }
  // R5b: surface platform announcements created in the admin panel.
  // عمداً حالت خطا ندارد: اگر این کوئری شکست بخورد نوار اعلان‌ها فقط پنهان
  // می‌ماند و هیچ توستی به کاربر نشان داده نمی‌شود — یک بنر تزئینی نباید
  // داشبورد را پر از خطا کند. (retry از queryClient گلوبال می‌آید: retry: 1.)
  const { data: announcements } = useQuery({
    queryKey: ["announcements"],
    queryFn: () => customFetch<DashboardAnnouncement[]>("/api/announcements"),
  });

  const nf = (n: number) => n.toLocaleString(lang === "fa" ? "fa-IR" : "en-US");
  const firstName = (user?.name || user?.platformUsername || "").trim().split(/\s+/)[0];

  return (
    <div className="space-y-8">
      <TrialWarningDialog />
      {/* خودش وقتی آپدیت دیده‌نشده‌ای نیست هیچ چیزی رندر نمی‌کند. */}
      <UpdateDialog />
      <PageHeader
        eyebrow={t.title}
        title={t.greeting.replace("{name}", firstName)}
        description={t.subtitle}
        actions={
          <MotionButton asChild size="lg">
            <Link href="/bots">
              <Plus className="me-2 h-4 w-4" /> {t.createBot}
            </Link>
          </MotionButton>
        }
      />

      {showTrialOffer && (
        <ForgePanel className="p-6 sm:p-7" embers={8}>
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/.28),0_14px_28px_-12px_hsl(var(--primary)/.9)]">
                <Gift className="size-7" />
              </div>
              <div>
                <p className="text-lg font-bold">{t.trialOfferTitle}</p>
                <p className="max-w-xl text-sm text-muted-foreground">{t.trialOfferDesc}</p>
              </div>
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <MotionButton className="flex-1 sm:flex-none" size="lg" onClick={() => setTrialOpen(true)}>
                <Gift className="me-2 h-4 w-4" /> {t.trialOfferCta}
              </MotionButton>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground"
                disabled={dismissingTrialOffer}
                onClick={() => void dismissTrialOffer()}
                aria-label={t.trialOfferDismiss}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </ForgePanel>
      )}
      <TrialDialog open={trialOpen} onOpenChange={setTrialOpen} />

      {announcements && announcements.length > 0 && (
        <div className="space-y-2">
          {announcements.map((a) => (
            <div
              key={a.id}
              className={`flex items-start gap-3 rounded-2xl border p-4 ${ANNOUNCEMENT_STYLES[a.type] ?? ANNOUNCEMENT_STYLES.info}`}
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
            const href = reason === "expired" || reason === "trialEndingSoon" ? "/products" : `/bots/${bot.id}`;
            return (
              <div
                key={bot.id}
                className={`flex flex-wrap items-center gap-3 rounded-2xl border p-3.5 ${ATTENTION_STYLES[reason]}`}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-current/10">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{bot.name}</p>
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="h-32 animate-pulse" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {/* The headline number gets the dark forge treatment; the rest are quiet tiles. */}
          <ForgePanel className="col-span-2 flex min-h-[9.5rem] flex-col justify-between rounded-3xl p-5" embers={6}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">{t.totalUsers}</span>
              <span className="flex size-8 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Users className="size-4" />
              </span>
            </div>
            <div>
              <div className="text-4xl font-bold leading-none tracking-tight tabular-nums">{nf(stats.totalUsers ?? 0)}</div>
              {stats.usersChange != null && <TrendBadge change={stats.usersChange} lang={lang} suffix={t.trendVsPrevious} />}
            </div>
          </ForgePanel>
          <StatTile label={t.totalBots} value={nf(stats.totalBots ?? 0)} icon={Bot} hint={
            <span className="tabular-nums">{nf(stats.activeBots ?? 0)} {t.activeBots}</span>
          } />
          <StatTile label={t.activeUsersToday} value={nf(stats.activeUsersToday ?? 0)} icon={MessageSquare} />
          {/* کارت درآمد فقط وقتی می‌آید که دست‌کم یک بات پلاگین کیف پول داشته باشد؛
              سرور در غیر این صورت `null` می‌دهد. */}
          {stats.totalRevenue != null && (
            <div className="col-span-2 flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card px-5 py-4 shadow-[var(--shadow-card)] lg:col-span-4">
              <span className="flex items-center gap-3 text-sm font-medium text-muted-foreground">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Wallet className="size-4" /></span>
                {t.revenue}
              </span>
              <span className="text-xl font-bold tabular-nums">{formatToman(stats.totalRevenue, lang)}</span>
            </div>
          )}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-5">
        {/* P49: a direct jump-off point into bot management, not just a count
            of how many exist — the missing piece that made this page a
            readout instead of a workspace. */}
        {bots && bots.length > 0 && (
          <Card className="xl:col-span-3">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">{t.yourBots}</CardTitle>
              {bots.length > QUICK_ACCESS_BOT_LIMIT && (
                <Button asChild variant="ghost" size="sm">
                  <Link href="/bots">
                    {t.viewAllBots} <ArrowRight className="ms-1.5 h-3.5 w-3.5 rtl-flip" />
                  </Link>
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <div className="grid gap-2.5">
                {bots.slice(0, QUICK_ACCESS_BOT_LIMIT).map((bot) => {
                  const st = botStatusMeta(bot.status, lang);
                  return (
                    <Link
                      key={bot.id}
                      href={`/bots/${bot.id}`}
                      className="group flex items-center gap-3.5 rounded-2xl border border-border/70 bg-background/60 p-3 transition-[border-color,background-color,transform] hover:-translate-y-px hover:border-primary/40 hover:bg-card"
                    >
                      {bot.avatar ? (
                        <img
                          src={bot.avatar}
                          alt=""
                          loading="lazy"
                          className="size-11 shrink-0 rounded-xl border border-border object-cover"
                        />
                      ) : (
                        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <Bot className="size-5" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{bot.name}</p>
                        <p dir="ltr" className="truncate text-start text-xs text-muted-foreground">
                          {bot.username ? `@${bot.username}` : t.noUsername}
                        </p>
                      </div>
                      <StatusPill tone={st.tone} pulse={st.pulse} className="shrink-0">{st.label}</StatusPill>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:text-primary rtl-flip" />
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        <Card className={bots && bots.length > 0 ? "xl:col-span-2" : "xl:col-span-5"}>
          <CardHeader>
            <CardTitle className="text-base">{t.recentActivity}</CardTitle>
          </CardHeader>
          <CardContent>
            {activityLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 bg-muted rounded-md animate-pulse" />
                ))}
              </div>
            ) : activity && activity.length > 0 ? (
              <motion.ol
                className="relative space-y-5 before:absolute before:inset-y-2 before:start-[1.125rem] before:w-px before:bg-border"
                initial="hidden"
                animate="show"
                variants={{ show: { transition: { staggerChildren: 0.05 } } }}
              >
                {activity.map((item: ActivityItem) => {
                  const Icon = ACTIVITY_ICONS[item.type] ?? Activity;
                  return (
                    <motion.li
                      key={item.id}
                      variants={{
                        hidden: { opacity: 0, x: reduce ? 0 : dir * -12 },
                        show: { opacity: 1, x: 0, transition: { type: "spring", duration: 0.3, bounce: 0.1 } },
                      }}
                      className="relative flex items-start gap-3.5"
                    >
                      <div className="relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full bg-card text-primary ring-4 ring-card [box-shadow:inset_0_0_0_1px_hsl(var(--primary)/.35)]">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 space-y-1 pt-0.5">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold leading-tight">
                          <span>{item.title}</span>
                          {item.botName && (
                            <Badge variant="secondary" className="shrink-0 font-normal">{item.botName}</Badge>
                          )}
                        </p>
                        <p className="text-sm text-muted-foreground">{item.description}</p>
                      </div>
                    </motion.li>
                  );
                })}
              </motion.ol>
            ) : (
              // P9: friendly empty state with a clear next action instead of dead gray text.
              <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
                  <Bot className="h-7 w-7" />
                </div>
                <div>
                  <p className="font-semibold">
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
