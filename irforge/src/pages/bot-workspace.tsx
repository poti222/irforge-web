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
import { ArrowLeft, Play, Square, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { BotWorkspaceDocument } from "@/components/bots/BotWorkspaceDocument";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";

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

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/bots"><ArrowLeft className="h-5 w-5 rtl-flip" /></Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <span className="truncate">{bot.name}</span>
            <Badge variant={bot.status === 'active' ? 'default' : 'secondary'}>{bot.status}</Badge>
          </h1>
          {bot.username && <p className="text-sm text-muted-foreground">@{bot.username}</p>}
        </div>
        <div className="flex items-center gap-2">
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
          ) : (
            <Badge variant="secondary">{bot.status}</Badge>
          )}
        </div>
      </div>

      {/* Q5: document shell (sidebar sections + main area, cross-fade) */}
      <BotWorkspaceDocument bot={bot} />
    </div>
  );
}
