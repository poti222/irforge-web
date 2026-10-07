import {
  useGetBot,
  useToggleBotStatus,
  getGetBotQueryKey,
  getListBotsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { GlowButton } from "@/components/ui/glow-button";
import { ArrowLeft, Play, Square, Loader2, Bot as BotIcon, ExternalLink, Crown, Gift } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { BotWorkspaceDocument } from "@/components/bots/BotWorkspaceDocument";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useLanguage } from "@/hooks/use-language";
import { ForgePanel } from "@/components/forge-ui/ForgePanel";
import { StatusPill } from "@/components/forge-ui/LiveDot";
import { botStatusMeta } from "@/lib/bot-status";
import { botLifetime, LIFETIME_TONE } from "@/lib/bot-lifetime";

// The bot process only reconciles against the registry sheet every ~20s
// (services/tenant_status_watcher.py on mainbot), so a start/stop click
// here doesn't take effect on the actual bot instantly. This countdown
// toast just sets that expectation instead of leaving the user assuming
// the click did nothing.
const STATUS_PROPAGATION_SECONDS = 20;

export default function BotWorkspace() {
  usePrivatePageTitle(useT("pageTitles").botWorkspace);
  const { botId } = useParams<{ botId: string }>();
  const t = useT("botWorkspace");
  const tb = useT("bots");
  const tt = useT("botTiers");
  const { lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: bot, isLoading } = useGetBot(botId);
  const toggle = useToggleBotStatus();

  // Tracks the in-flight countdown toast (if any) so a second click can
  // clear the previous timer/toast instead of stacking two of them.
  const countdownRef = useRef<{
    intervalId: ReturnType<typeof setInterval>;
    dismiss: () => void;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current.intervalId);
        countdownRef.current.dismiss();
      }
    };
  }, []);

  function startStatusCountdown(status: "active" | "inactive") {
    if (countdownRef.current) {
      clearInterval(countdownRef.current.intervalId);
      countdownRef.current.dismiss();
      countdownRef.current = null;
    }

    let remaining = STATUS_PROPAGATION_SECONDS;
    const describe = (seconds: number) =>
      (status === "active" ? t.botStartingCountdown : t.botStoppingCountdown).replace(
        "{seconds}",
        String(seconds)
      );

    // While the 20s countdown is running, the toast's own 5s auto-close
    // timer must stay off — it should only start once the final
    // "started/stopped" message below is shown.
    const handle = toast({
      title: status === "active" ? t.botStarted : t.botStopped,
      description: describe(remaining),
      autoClose: false,
    });

    const intervalId = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(intervalId);
        countdownRef.current = null;
        handle.update({
          id: handle.id,
          title: status === "active" ? t.botStarted : t.botStopped,
          description: undefined,
          autoClose: true,
          autoCloseKey: Date.now(),
        } as any);
        return;
      }
      handle.update({ id: handle.id, description: describe(remaining) } as any);
    }, 1000);

    countdownRef.current = { intervalId, dismiss: handle.dismiss };
  }

  if (isLoading) {
    return <div className="p-8 text-center animate-pulse">{t.loadingWorkspace}</div>;
  }
  if (!bot) {
    return <div className="p-8 text-center">{t.botNotFound}</div>;
  }

  // P1: Start/Stop wired to PATCH /bots/:botId/status with pending + toast + invalidate.
  function setStatus(status: "active" | "inactive") {
    if (!bot) return;
    toggle.mutate(
      { botId: bot.id, data: { status } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBotQueryKey(bot.id) });
          queryClient.invalidateQueries({ queryKey: getListBotsQueryKey() });
          startStatusCountdown(status);
        },
        onError: (err: any) =>
          toast({ variant: "destructive", title: t.error, description: err?.message }),
      }
    );
  }

  const st = botStatusMeta(bot.status, lang);
  const life = botLifetime(bot, lang);
  const tierLabel = bot.tier === "standard" ? tt.standard.name : bot.tier === "pro" ? tt.pro.name : bot.tier === "custom" ? tt.custom.name : "";
  const nf = (n: number | undefined) => (n ?? 0).toLocaleString(lang === "fa" ? "fa-IR" : "en-US");

  return (
    <div className="space-y-6">
      {/* Hero: who this bot is, whether it is running, and the one switch you
          reach for most. Everything else lives in the section rail below. */}
      <ForgePanel className="p-5 sm:p-7" embers={12}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Button variant="ghost" size="icon" asChild className="-ms-2 shrink-0 text-muted-foreground hover:text-foreground">
              <Link href="/bots" aria-label={tb.title}><ArrowLeft className="h-5 w-5 rtl-flip" /></Link>
            </Button>
            {bot.avatar ? (
              <img src={bot.avatar} alt={t.botAvatarAlt} className="size-16 shrink-0 rounded-2xl border border-white/10 object-cover" />
            ) : (
              <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/.28),0_14px_28px_-12px_hsl(var(--primary)/.9)]">
                <BotIcon className="h-8 w-8" />
              </div>
            )}
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h1 className="truncate text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{bot.name}</h1>
                <StatusPill tone={st.tone} pulse={st.pulse}>{st.label}</StatusPill>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {bot.username && (
                  <a href={`https://t.me/${bot.username}`} target="_blank" rel="noopener noreferrer" dir="ltr" className="hover:text-primary hover:underline">
                    @{bot.username}
                  </a>
                )}
                <span className="tabular-nums">{nf(bot.userCount)} {tb.usersLabel}</span>
                <span className="tabular-nums">{nf(bot.commandCount)} {tb.commandsLabel}</span>
                <span className="tabular-nums">{nf(bot.pluginCount)} {t.overviewPlugins}</span>
              </div>
              {(tierLabel || life) && (
                <div className="flex flex-wrap items-center gap-2">
                  {tierLabel && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                      <Crown className="size-3" /> {tierLabel}
                    </span>
                  )}
                  {life && (
                    <Badge variant="outline" className={`flex w-fit items-center gap-1 ${LIFETIME_TONE[life.tone]}`}>
                      <Gift className="size-3" /> {life.text}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {bot.username && (
              <Button variant="outline" size="sm" asChild className="bg-white/5">
                <a href={`https://t.me/${bot.username}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="me-2 h-4 w-4" /> {t.openInTelegram}
                </a>
              </Button>
            )}
            {bot.status === 'active' ? (
              <Button variant="destructive" size="sm" onClick={() => setStatus("inactive")} disabled={toggle.isPending}>
                {toggle.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Square className="me-2 h-4 w-4" />}
                {t.stopBot}
              </Button>
            ) : bot.status === 'inactive' ? (
              <GlowButton variant="default" size="sm" onClick={() => setStatus("active")} disabled={toggle.isPending}>
                {toggle.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Play className="me-2 h-4 w-4" />}
                {t.startBot}
              </GlowButton>
            ) : bot.status === 'pending_payment' ? (
              <Badge variant="outline" className="text-amber-500 border-amber-500">
                {t.awaitingPaymentApproval}
              </Badge>
            ) : bot.status === 'payment_rejected' ? (
              <Badge variant="destructive">{t.paymentRejected}</Badge>
            ) : null}
          </div>
        </div>
      </ForgePanel>

      {/* Q5: document shell (section rail + main area, cross-fade) */}
      <BotWorkspaceDocument bot={bot} />
    </div>
  );
}
