/**
 * TabAntiFlood.tsx — محدودیت نرخ پیام کاربر.
 * معادل `ap:s:flood_cfg` در `handlers/admin_panel.py`.
 *
 * هر عدد یک توضیح یک‌خطی زیرش دارد: «۵ پیام در ۵ ثانیه» بدون توضیح، برای
 * کسی که اولین بارش است هیچ معنایی ندارد.
 */
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { SettingsSaveBar, SettingsError, CachePropagationNotice } from "./SettingsSaveBar";
import { useDraft } from "./useDraft";
import { useSaveAntiFlood, type AntiFlood, type SettingsEnvelope } from "./api";

function NumberField({
  id,
  label,
  hint,
  value,
  min,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  onChange: (next: number) => void;
}) {
  const invalid = !Number.isInteger(value) || value < min;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        dir="ltr"
        min={min}
        value={Number.isFinite(value) ? value : min}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-invalid={invalid || undefined}
      />
      <p className={`text-xs ${invalid ? "text-destructive" : "text-muted-foreground"}`}>{hint}</p>
    </div>
  );
}

export function TabAntiFlood({ botId, data }: { botId: string; data: SettingsEnvelope }) {
  const t = useT("botSettings");
  const { toast } = useToast();
  const draft = useDraft<AntiFlood & Record<string, unknown>>(
    `settings:antiFlood:${botId}`,
    data.settings.anti_flood as AntiFlood & Record<string, unknown>
  );
  const save = useSaveAntiFlood(botId);
  const af = draft.value as AntiFlood;

  const invalid =
    !Number.isInteger(af.max_messages) || af.max_messages < 1 ||
    !Number.isInteger(af.interval_seconds) || af.interval_seconds < 1 ||
    !Number.isInteger(af.ban_duration_seconds) || af.ban_duration_seconds < 0;

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{t.antiFloodTitle}</CardTitle>
        <CardDescription>{t.antiFloodDesc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
          <div className="min-w-0">
            <Label htmlFor="af-enabled">{t.antiFloodEnabled}</Label>
            <p className="text-xs text-muted-foreground">{t.antiFloodEnabledHint}</p>
          </div>
          <Switch id="af-enabled" checked={af.enabled} onCheckedChange={(v) => draft.set("enabled", v)} />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField
            id="af-max" label={t.maxMessages} hint={t.maxMessagesHint}
            value={af.max_messages} min={1}
            onChange={(v) => draft.set("max_messages", v)}
          />
          <NumberField
            id="af-interval" label={t.intervalSeconds} hint={t.intervalSecondsHint}
            value={af.interval_seconds} min={1}
            onChange={(v) => draft.set("interval_seconds", v)}
          />
          <NumberField
            id="af-ban" label={t.banDuration} hint={t.banDurationHint}
            value={af.ban_duration_seconds} min={0}
            onChange={(v) => draft.set("ban_duration_seconds", v)}
          />
        </div>

        <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          {t.antiFloodSummary
            .replace("{max}", String(af.max_messages))
            .replace("{interval}", String(af.interval_seconds))
            .replace("{ban}", String(af.ban_duration_seconds))}
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="af-warn">{t.warnMessage}</Label>
          <Textarea
            id="af-warn" rows={2}
            value={af.warn_message}
            onChange={(e) => draft.set("warn_message", e.target.value)}
          />
        </div>

        <SettingsError error={save.error} />
        <CachePropagationNotice cacheBust={data.cacheBust} />
        <SettingsSaveBar
          dirty={draft.dirty && !invalid}
          saving={save.isPending}
          onSave={() => save.mutate(af, { onSuccess: () => { draft.markSaved(); toast({ title: t.saved }); } })}
          onRevert={draft.reset}
        />
      </CardContent>
    </Card>
  );
}
