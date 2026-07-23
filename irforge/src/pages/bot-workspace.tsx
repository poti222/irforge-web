import {
  useGetBot,
  useToggleBotStatus,
  getGetBotQueryKey,
  getListBotsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { GlowButton } from "@/components/ui/glow-button";
import { ArrowLeft, Play, Square, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { BotWorkspaceDocument } from "@/components/bots/BotWorkspaceDocument";

export default function BotWorkspace() {
  const { botId } = useParams<{ botId: string }>();
  const t = useT("botWorkspace");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: bot, isLoading } = useGetBot(botId);
  const toggle = useToggleBotStatus();

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
          toast({
            title: status === "active" ? t.botStarted : t.botStopped,
          });
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
