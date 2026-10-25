import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Gamepad2, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/forge-ui/PageHeader";
import { RefreshButton } from "@/components/ui/refresh-button";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { adminListDiscordBots, adminSuspendDiscordBot, discordErrorText, DiscordApiError } from "@/lib/discord-bots-api";
import { BotStatusPill } from "@/components/discord/status";

/** pages/admin-discord-bots.tsx — نمای ادمین: همه‌ی بات‌های دیسکورد، وضعیت اجرا، تعلیق/رفع تعلیق. */
export default function AdminDiscordBots() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const t = (a: string, b: string) => (fa ? a : b);
  const { toast } = useToast();
  const qc = useQueryClient();
  usePrivatePageTitle(t("بات‌های دیسکورد (ادمین)", "Discord bots (admin)"));
  const q = useQuery({ queryKey: ["admin-discord-bots"], queryFn: adminListDiscordBots, refetchInterval: 10000 });
  const suspend = useMutation({
    mutationFn: (v: { id: string; suspended: boolean }) => adminSuspendDiscordBot(v.id, v.suspended),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-discord-bots"] }),
    onError: (e: unknown) => toast({ title: t("انجام نشد", "Failed"), description: discordErrorText(e instanceof DiscordApiError ? e.code : "unknown", fa), variant: "destructive" }),
  });
  const bots = q.data?.bots ?? [];
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <PageHeader icon={<Gamepad2 />} title={t("بات‌های دیسکورد", "Discord bots")} description={t("همه‌ی بات‌های دیسکورد کاربران و وضعیت اجرای آن‌ها.", "Every user's Discord bots and their runtime state.")}
        actions={<RefreshButton queryKeys={[["admin-discord-bots"]]} />} />
      {q.isLoading ? <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin" /></div> : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs"><tr>
                {[t("بات", "Bot"), t("مالک", "Owner"), t("وضعیت", "Status"), t("سرور", "Servers"), t("دستور/رویداد", "Cmds/Events"), ""].map((h, i) => <th key={i} className="p-3 text-start font-medium">{h}</th>)}
              </tr></thead>
              <tbody>
                {bots.map((b) => (
                  <tr key={b.id} className="border-t">
                    <td className="p-3"><div className="font-medium">{b.name}</div><div className="text-xs text-muted-foreground" dir="ltr">{b.botUsername ? `@${b.botUsername}` : "—"}</div></td>
                    <td className="p-3 text-xs" dir="ltr">{b.ownerUsername ?? b.userId}</td>
                    <td className="p-3"><BotStatusPill bot={b} fa={fa} />{b.runtimeErrorCode && <Badge variant="outline" className="ms-2 text-[10px]">{b.runtimeErrorCode}</Badge>}</td>
                    <td className="p-3">{b.guildCount}</td>
                    <td className="p-3">{b.counts.commands}/{b.counts.events}</td>
                    <td className="p-3 text-end">
                      <Button size="sm" variant={b.status === "suspended" ? "outline" : "destructive"} disabled={suspend.isPending} onClick={() => suspend.mutate({ id: b.id, suspended: b.status !== "suspended" })}>
                        {b.status === "suspended" ? <><ShieldCheck className="me-1 size-3.5" />{t("رفع تعلیق", "Unsuspend")}</> : <><ShieldAlert className="me-1 size-3.5" />{t("تعلیق", "Suspend")}</>}
                      </Button>
                    </td>
                  </tr>
                ))}
                {bots.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">{t("باتی ثبت نشده.", "No bots yet.")}</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
