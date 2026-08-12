/**
 * TabPayment.tsx — اطلاعات پرداخت و یوزرنیم پشتیبانی.
 * معادل `ap:s:payment_info` و `ap:s:support` در `handlers/admin_panel.py`.
 */
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { SettingsSaveBar, SettingsError, CachePropagationNotice } from "./SettingsSaveBar";
import { useDraft } from "./useDraft";
import { usePatchBotSettings, type BotSettings, type SettingsEnvelope } from "./api";

type PaymentDraft = {
  payment_info: string;
  support_username: string;
};

function pick(settings: BotSettings): PaymentDraft {
  return {
    payment_info: settings.payment_info,
    support_username: settings.support_username,
  };
}

export function TabPayment({ botId, data }: { botId: string; data: SettingsEnvelope }) {
  const t = useT("botSettings");
  const { toast } = useToast();
  const draft = useDraft<PaymentDraft>(`settings:payment:${botId}`, pick(data.settings));
  const patch = usePatchBotSettings(botId);

  const username = draft.value.support_username ?? "";
  // همان قاعده‌ای که سرور enforce می‌کند — تا کاربر قبل از ذخیره خطا را ببیند.
  const usernameInvalid = username !== "" && !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username);

  function save() {
    patch.mutate(draft.value as Partial<BotSettings>, {
      onSuccess: () => toast({ title: t.saved, description: data.cacheBust ? t.propagationFast : t.propagationSlow }),
    });
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{t.paymentTitle}</CardTitle>
        <CardDescription>{t.paymentDesc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="pay-info">{t.paymentInfo}</Label>
          <Textarea
            id="pay-info"
            rows={4}
            value={draft.value.payment_info ?? ""}
            onChange={(e) => draft.set("payment_info", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t.paymentInfoHint}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pay-support">{t.supportUsername}</Label>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground" dir="ltr">@</span>
            <Input
              id="pay-support"
              dir="ltr"
              value={username}
              // `@` ابتدای ورودی همان‌جا حذف می‌شود تا کاربر `@@name` نسازد.
              onChange={(e) => draft.set("support_username", e.target.value.replace(/^@+/, ""))}
              aria-invalid={usernameInvalid || undefined}
            />
          </div>
          {usernameInvalid ? (
            <p className="text-xs text-destructive">{t.supportUsernameInvalid}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{t.supportUsernameHint}</p>
          )}
        </div>

        <SettingsError error={patch.error} />
        <CachePropagationNotice cacheBust={data.cacheBust} />
        <SettingsSaveBar
          dirty={draft.dirty}
          saving={patch.isPending}
          onSave={save}
          onRevert={draft.reset}
        />
      </CardContent>
    </Card>
  );
}
