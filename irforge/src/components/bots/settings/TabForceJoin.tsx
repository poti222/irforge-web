/**
 * TabForceJoin.tsx — کانال‌های عضویت اجباری + پیام مربوطه.
 * معادل `ap:channels` در `handlers/admin_panel.py`.
 *
 * دکمه‌ی «بررسی دسترسی» با `getChatMember` چک می‌کند بات در کانال ادمین هست یا
 * نه. اگر توکن روی سرور نباشد یا تلگرام جواب ندهد، یک نتیجه‌ی «نامعلوم» با
 * پیام روشن برمی‌گردد — نه crash و نه ادعای دروغِ «همه‌چیز درست است».
 */
import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Plus, Trash2, Loader2, ShieldCheck, ShieldAlert, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { SettingsSaveBar, SettingsError, CachePropagationNotice } from "./SettingsSaveBar";
import { useDraft } from "./useDraft";
import {
  useAddForceJoinChannel,
  useRemoveForceJoinChannel,
  usePatchBotSettings,
  apiErrorMessage,
  type BotSettings,
  type SettingsEnvelope,
} from "./api";

type CheckResult = { status: "ok" | "error" | "unknown"; message: string };

type MessageDraft = { force_join_message: string };

export function TabForceJoin({ botId, data }: { botId: string; data: SettingsEnvelope }) {
  const t = useT("botSettings");
  const { toast } = useToast();

  const channels = data.settings.force_join_channels;
  const [newChannel, setNewChannel] = useState("");
  const [checks, setChecks] = useState<Record<string, CheckResult | "loading">>({});

  const add = useAddForceJoinChannel(botId);
  const remove = useRemoveForceJoinChannel(botId);
  const patch = usePatchBotSettings(botId);
  const draft = useDraft<MessageDraft>(`settings:forceJoin:${botId}`, {
    force_join_message: data.settings.force_join_message,
  });

  function addChannel() {
    const value = newChannel.trim();
    if (!value) return;
    add.mutate(value, {
      onSuccess: () => {
        setNewChannel("");
        toast({ title: t.channelAdded });
      },
      onError: (err: any) =>
        toast({ variant: "destructive", title: t.errorGeneric, description: apiErrorMessage(err, t.errorGeneric) }),
    });
  }

  async function checkChannel(channel: string) {
    setChecks((prev) => ({ ...prev, [channel]: "loading" }));
    try {
      const res = await customFetch<CheckResult>(`/api/bots/${botId}/settings/channels/check`, {
        method: "POST",
        body: JSON.stringify({ channel }),
      });
      setChecks((prev) => ({ ...prev, [channel]: res }));
    } catch (err: any) {
      setChecks((prev) => ({
        ...prev,
        [channel]: { status: "unknown", message: apiErrorMessage(err, t.errorGeneric) },
      }));
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t.forceJoinTitle}</CardTitle>
          <CardDescription>{t.forceJoinDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              dir="ltr"
              value={newChannel}
              placeholder="@my_channel"
              onChange={(e) => setNewChannel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addChannel();
                }
              }}
            />
            <Button onClick={addChannel} disabled={!newChannel.trim() || add.isPending} className="shrink-0">
              {add.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Plus className="me-2 h-4 w-4" />}
              {t.addChannel}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t.channelFormatHint}</p>

          {channels.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t.noChannels}
            </p>
          ) : (
            <ul className="space-y-2">
              {channels.map((channel, index) => {
                const check = checks[channel];
                return (
                  <li key={`${channel}-${index}`} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span dir="ltr" className="flex-1 truncate font-mono text-sm">{channel}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => checkChannel(channel)}
                        disabled={check === "loading"}
                      >
                        {check === "loading" ? (
                          <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ShieldCheck className="me-1.5 h-3.5 w-3.5" />
                        )}
                        {t.checkAccess}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t.removeChannel}
                        onClick={() => remove.mutate(index)}
                        disabled={remove.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                    {check && check !== "loading" && (
                      <p
                        className={`mt-2 flex items-start gap-1.5 text-xs ${
                          check.status === "ok"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : check.status === "error"
                              ? "text-destructive"
                              : "text-muted-foreground"
                        }`}
                      >
                        {check.status === "ok" ? (
                          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                        ) : check.status === "error" ? (
                          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                        ) : (
                          <HelpCircle className="mt-0.5 size-3.5 shrink-0" />
                        )}
                        <span>{check.message}</span>
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.forceJoinMessageTitle}</CardTitle>
          <CardDescription>{t.forceJoinMessageDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="fj-message">{t.msg_force_join_message}</Label>
            <Textarea
              id="fj-message"
              rows={3}
              value={draft.value.force_join_message ?? ""}
              onChange={(e) => draft.set("force_join_message", e.target.value)}
            />
          </div>
          <SettingsError error={patch.error} />
          <CachePropagationNotice cacheBust={data.cacheBust} />
          <SettingsSaveBar
            dirty={draft.dirty}
            saving={patch.isPending}
            onSave={() =>
              patch.mutate(draft.value as Partial<BotSettings>, {
                onSuccess: () => toast({ title: t.saved }),
              })
            }
            onRevert={draft.reset}
          />
        </CardContent>
      </Card>
    </div>
  );
}
