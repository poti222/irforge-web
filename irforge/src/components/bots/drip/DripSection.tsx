/**
 * DripSection.tsx — IRFORGE_PROMPT_V3 Phase 19
 * ─────────────────────────────────────────────────────────────────────────────
 * List + editor for the `drip` plugin's scheduled campaigns: event-triggered
 * (existing), plus the two new schedule types (absolute datetime, weekly
 * recurring), media/button attachments, an audience picker, and quiet-hours
 * + frequency-cap safety settings. The bot process remains the sender — this
 * section only writes campaign rows through `lib/dripStore.ts`
 * (`api-server/src/routes/drip.ts`), same split as booking/address.
 *
 * Media reuses the same `/api/bots/:botId/media` upload the address plugin
 * uses (image/audio only — no video, a pre-existing product constraint of
 * that endpoint) rather than the "send via bot" rich-capture flow: the bot's
 * `send_campaign_message` only knows `message` (plain text) + one
 * `media_file_id`/`media_type` pair, not Telegram formatting entities, so
 * capturing more than that would be UI complexity the runtime can't use.
 *
 * Buttons reuse `ButtonBuilder`/`panel-buttons.ts` as-is: the extra UI-only
 * fields it carries (`col`, `row_start`, `style`) are simply ignored by the
 * bot's `_button_kwargs` (`plugins/drip/domain.py`), which only reads
 * `row`/`label`/`action`/`value`.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import {
  Send, Loader2, Plus, Trash2, Pencil, FlaskConical, Clock, Repeat, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";
import {
  buttonsToRows, rowsToButtons, type PanelButton,
} from "@/lib/panel-buttons";
import { ButtonBuilder } from "../panels/ButtonBuilder";
import { usePanels } from "../panels/api";
import {
  gregorianToJalali, jalaliToGregorian, jalaliDatetimeToUtc, utcToJalaliDatetime,
  weekdayNameFa, toPersianDigits,
} from "@/lib/tehran-time";

type ScheduleType = "event" | "datetime" | "recurring";
type AudienceMode = "all_users" | "segment" | "single_chat";

type Campaign = {
  id: string;
  title: string;
  schedule_type: ScheduleType;
  trigger_event: string;
  delay_minutes: number;
  once_per_user: boolean;
  run_at: string;
  fired_at: string;
  recurring_days: number[];
  recurring_time: string;
  recurring_end_date: string;
  message: string;
  media_file_id: string;
  media_type: string;
  buttons: PanelButton[];
  audience_mode: AudienceMode;
  audience_value: string;
  is_active: boolean;
  queued_count: number;
  sent_count: number;
};

type SafetyConfig = {
  quiet_hours_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  frequency_cap_enabled: boolean;
  max_per_user_per_hour: number;
};

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}

const TODAY = new Date();
const [TODAY_JY] = gregorianToJalali(TODAY.getFullYear(), TODAY.getMonth() + 1, TODAY.getDate());

/** یک تاریخِ شمسی با سه عددِ ساده — بدون نیاز به یک کتابخانه‌ی تقویمِ جدید. */
function JalaliDateInput({
  jy, jm, jd, onChange,
}: { jy: number; jm: number; jd: number; onChange: (jy: number, jm: number, jd: number) => void }) {
  return (
    <div dir="ltr" className="flex items-center gap-1.5">
      <Input
        type="number" className="w-20" value={jy} min={TODAY_JY - 1} max={TODAY_JY + 5}
        onChange={(e) => onChange(Number(e.target.value) || jy, jm, jd)}
      />
      <span className="text-muted-foreground">/</span>
      <Input
        type="number" className="w-16" value={jm} min={1} max={12}
        onChange={(e) => onChange(jy, Math.min(12, Math.max(1, Number(e.target.value) || 1)), jd)}
      />
      <span className="text-muted-foreground">/</span>
      <Input
        type="number" className="w-16" value={jd} min={1} max={31}
        onChange={(e) => onChange(jy, jm, Math.min(31, Math.max(1, Number(e.target.value) || 1)))}
      />
    </div>
  );
}

const DAY_LABELS = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, label: weekdayNameFa(d) }));

/** رویدادهای انتخاب‌پذیر: از مانیفستِ پلاگین‌های فعالِ همین بات — همان چیزی
 * که `dm.available_triggers()`ی بات هم می‌بیند، منهای رویدادهای هسته‌ای که
 * فقط داخل خودِ پایتون تعریف شده‌اند (به همین دلیل ورودیِ الگوی دستی هم هست). */
function useTriggerOptions(botId: string) {
  const { data } = useQuery({
    queryKey: ["bot-plugins", botId],
    queryFn: () => customFetch<{ plugins: Array<{ id: string; enabled: boolean; name_fa?: string; name: string; events?: string[] }> }>(`/api/bots/${botId}/plugins`),
    staleTime: 60_000,
  });
  return useMemo(() => {
    const out: Array<{ event: string; label: string }> = [];
    for (const p of data?.plugins ?? []) {
      if (!p.enabled) continue;
      for (const event of p.events ?? []) out.push({ event, label: `${p.name_fa || p.name}: ${event}` });
    }
    return out;
  }, [data]);
}

function useFormOptions(botId: string) {
  return useQuery({
    queryKey: ["bot-form-options", botId],
    queryFn: async () => {
      try {
        const res = await customFetch<{ forms: Array<{ id: string; title: string }> }>(`/api/bots/${botId}/forms`);
        return res.forms ?? [];
      } catch {
        return [] as Array<{ id: string; title: string }>;
      }
    },
    staleTime: 60_000,
  });
}

function scheduleSummary(t: any, c: Campaign): string {
  if (c.schedule_type === "datetime") {
    if (!c.run_at) return t.scheduleDatetime;
    const { jy, jm, jd, hour, minute } = utcToJalaliDatetime(c.run_at);
    const when = toPersianDigits(`${jy}/${String(jm).padStart(2, "0")}/${String(jd).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    return `${t.scheduleDatetime} — ${when}`;
  }
  if (c.schedule_type === "recurring") {
    const days = (c.recurring_days ?? []).map(weekdayNameFa).join("، ") || "—";
    return `${t.scheduleRecurring} — ${days} ${c.recurring_time || ""}`;
  }
  return `${t.scheduleEvent}: ${c.trigger_event || "—"}`;
}

function CampaignEditor({
  botId, campaign, triggers, panels, forms, onClose,
}: {
  botId: string;
  campaign: Campaign | null;
  triggers: Array<{ event: string; label: string }>;
  panels: any[];
  forms: Array<{ id: string; title: string }>;
  onClose: () => void;
}) {
  const t = useT("botDrip");
  const { toast } = useToast();
  const qc = useQueryClient();

  const [title, setTitle] = useState(campaign?.title ?? "");
  const [scheduleType, setScheduleType] = useState<ScheduleType>(campaign?.schedule_type ?? "event");
  const [message, setMessage] = useState(campaign?.message ?? "");
  const [onceOnly, setOnceOnly] = useState(campaign?.once_per_user ?? true);
  const [isActive, setIsActive] = useState(campaign?.is_active ?? true);

  // event
  const [triggerEvent, setTriggerEvent] = useState(campaign?.trigger_event ?? "");
  const [customTrigger, setCustomTrigger] = useState(false);
  const [delayMinutes, setDelayMinutes] = useState(campaign?.delay_minutes ?? 0);

  // datetime
  const initialDt = campaign?.run_at ? utcToJalaliDatetime(campaign.run_at) : null;
  const nowJalali = gregorianToJalali(TODAY.getFullYear(), TODAY.getMonth() + 1, TODAY.getDate());
  const [runJy, setRunJy] = useState(initialDt?.jy ?? nowJalali[0]);
  const [runJm, setRunJm] = useState(initialDt?.jm ?? nowJalali[1]);
  const [runJd, setRunJd] = useState(initialDt?.jd ?? nowJalali[2]);
  const [runTime, setRunTime] = useState(
    initialDt ? `${String(initialDt.hour).padStart(2, "0")}:${String(initialDt.minute).padStart(2, "0")}` : "09:00"
  );

  // recurring
  const [recurringDays, setRecurringDays] = useState<number[]>(campaign?.recurring_days ?? []);
  const [recurringTime, setRecurringTime] = useState(campaign?.recurring_time ?? "09:00");
  const hasEndDate = Boolean(campaign?.recurring_end_date);
  const [useEndDate, setUseEndDate] = useState(hasEndDate);
  const endJalaliInit = hasEndDate
    ? (() => { const [y, m, d] = campaign!.recurring_end_date.split("-").map(Number); return gregorianToJalali(y, m, d); })()
    : nowJalali;
  const [endJy, setEndJy] = useState(endJalaliInit[0]);
  const [endJm, setEndJm] = useState(endJalaliInit[1]);
  const [endJd, setEndJd] = useState(endJalaliInit[2]);

  // media
  const [mediaFileId, setMediaFileId] = useState(campaign?.media_file_id ?? "");
  const [mediaType, setMediaType] = useState(campaign?.media_type ?? "");
  const [uploading, setUploading] = useState(false);

  // buttons
  const [rows, setRows] = useState<PanelButton[][]>(buttonsToRows(campaign?.buttons ?? []));

  // audience
  const [audienceMode, setAudienceMode] = useState<AudienceMode>(campaign?.audience_mode ?? "all_users");
  const [audienceValue, setAudienceValue] = useState(campaign?.audience_value ?? "");

  function toggleDay(day: number) {
    setRecurringDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)));
  }

  async function handleMedia(file: File) {
    setUploading(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const result = await customFetch<{ fileId: string; type: string }>(`/api/bots/${botId}/media`, {
        method: "POST",
        body: JSON.stringify({ dataUrl, filename: file.name }),
      });
      setMediaFileId(result.fileId);
      setMediaType(result.type);
    } catch (err: any) {
      toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) });
    } finally {
      setUploading(false);
    }
  }

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        title, schedule_type: scheduleType, message,
        once_per_user: onceOnly, is_active: isActive,
        media_file_id: mediaFileId, media_type: mediaType,
        buttons: rowsToButtons(rows),
        audience_mode: audienceMode, audience_value: audienceMode === "single_chat" ? audienceValue : "",
      };
      if (scheduleType === "event") {
        body.trigger_event = triggerEvent;
        body.delay_minutes = delayMinutes;
      }
      if (scheduleType === "datetime") {
        const [h, m] = runTime.split(":").map(Number);
        body.run_at = jalaliDatetimeToUtc(runJy, runJm, runJd, h || 0, m || 0);
      }
      if (scheduleType === "recurring") {
        body.recurring_days = recurringDays;
        body.recurring_time = recurringTime;
        if (useEndDate) {
          const [gy, gm, gd] = jalaliToGregorian(endJy, endJm, endJd);
          body.recurring_end_date = `${gy}-${String(gm).padStart(2, "0")}-${String(gd).padStart(2, "0")}`;
        } else {
          body.recurring_end_date = "";
        }
      }
      return campaign
        ? customFetch(`/api/bots/${botId}/drip/campaigns/${campaign.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : customFetch(`/api/bots/${botId}/drip/campaigns`, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-drip-campaigns", botId] });
      toast({ title: campaign ? t.campaignUpdated : t.campaignCreated });
      onClose();
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const canSave =
    title.trim() && message.trim() &&
    (scheduleType !== "event" || triggerEvent.trim()) &&
    (scheduleType !== "recurring" || recurringDays.length > 0) &&
    (audienceMode !== "single_chat" || audienceValue.trim());

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{campaign ? t.editCampaign : t.newCampaign}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>{t.fieldTitle}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
          </div>

          <div className="space-y-1.5">
            <Label>{t.fieldScheduleType}</Label>
            <Select value={scheduleType} onValueChange={(v) => setScheduleType(v as ScheduleType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="event">{t.scheduleEvent}</SelectItem>
                <SelectItem value="datetime">{t.scheduleDatetime}</SelectItem>
                <SelectItem value="recurring">{t.scheduleRecurring}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {scheduleType === "event" && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-1.5">
                <Label>{t.fieldTrigger}</Label>
                {!customTrigger ? (
                  <Select
                    value={triggers.some((tr) => tr.event === triggerEvent) ? triggerEvent : "__none__"}
                    onValueChange={(v) => (v === "__custom__" ? setCustomTrigger(true) : setTriggerEvent(v === "__none__" ? "" : v))}
                  >
                    <SelectTrigger><SelectValue placeholder={t.pickTrigger} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t.pickTrigger}</SelectItem>
                      {triggers.map((tr) => <SelectItem key={tr.event} value={tr.event}>{tr.label}</SelectItem>)}
                      <SelectItem value="__custom__">{t.advancedPattern}</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="space-y-1">
                    <Input dir="ltr" value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)} placeholder="event.booking.*" />
                    <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setCustomTrigger(false)}>
                      {t.pickFromList}
                    </button>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">{t.triggerHelp}</p>
              </div>
              <div className="space-y-1.5">
                <Label>{t.fieldDelay}</Label>
                <Input
                  type="number" dir="ltr" min={0} max={129600} value={delayMinutes}
                  onChange={(e) => setDelayMinutes(Math.max(0, Number(e.target.value) || 0))}
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={onceOnly} onCheckedChange={setOnceOnly} />
                <span className="text-sm">{t.fieldOncePerUser}</span>
              </div>
            </div>
          )}

          {scheduleType === "datetime" && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-1.5">
                <Label>{t.fieldDate}</Label>
                <JalaliDateInput jy={runJy} jm={runJm} jd={runJd} onChange={(y, m, d) => { setRunJy(y); setRunJm(m); setRunJd(d); }} />
              </div>
              <div className="space-y-1.5">
                <Label>{t.fieldTime}</Label>
                <Input type="time" dir="ltr" className="w-32" value={runTime} onChange={(e) => setRunTime(e.target.value)} />
              </div>
              {campaign?.fired_at && <p className="text-xs text-muted-foreground">{t.alreadyFired}</p>}
            </div>
          )}

          {scheduleType === "recurring" && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-2">
                <Label>{t.fieldRecurringDays}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {DAY_LABELS.map(({ day, label }) => {
                    const active = recurringDays.includes(day);
                    return (
                      <button
                        key={day} type="button" onClick={() => toggleDay(day)} aria-pressed={active}
                        className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${active ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t.fieldTime}</Label>
                <Input type="time" dir="ltr" className="w-32" value={recurringTime} onChange={(e) => setRecurringTime(e.target.value)} />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <Switch checked={useEndDate} onCheckedChange={setUseEndDate} />
                  <span className="text-sm">{t.fieldRecurringEndDate}</span>
                </div>
                {useEndDate && (
                  <JalaliDateInput jy={endJy} jm={endJm} jd={endJd} onChange={(y, m, d) => { setEndJy(y); setEndJm(m); setEndJd(d); }} />
                )}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label>{t.fieldMessage}</Label>
            <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={3000} />
          </div>

          <div className="space-y-1">
            <Label>{t.fieldMedia}</Label>
            <div className="flex items-center gap-3">
              {mediaFileId && (
                <Badge variant="outline" className="gap-1">
                  {mediaType} <button type="button" onClick={() => { setMediaFileId(""); setMediaType(""); }}>×</button>
                </Badge>
              )}
              <Input
                type="file" accept="image/*,audio/*" disabled={uploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleMedia(f); }}
              />
              {uploading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            </div>
            <p className="text-xs text-muted-foreground">{t.mediaHelp}</p>
          </div>

          <div className="space-y-1.5">
            <Label>{t.fieldButtons}</Label>
            <ButtonBuilder rows={rows} panels={panels} forms={forms} catalog={undefined} onChange={setRows} />
          </div>

          <div className="space-y-1.5">
            <Label>{t.fieldAudience}</Label>
            <Select value={audienceMode} onValueChange={(v) => setAudienceMode(v as AudienceMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_users">{t.audienceAll}</SelectItem>
                <SelectItem value="single_chat">{t.audienceSingle}</SelectItem>
                <SelectItem value="segment" disabled>{t.audienceSegment}</SelectItem>
              </SelectContent>
            </Select>
            {audienceMode === "single_chat" && (
              <Input dir="ltr" placeholder="@username یا chat id" value={audienceValue} onChange={(e) => setAudienceValue(e.target.value)} />
            )}
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            <span className="text-sm">{t.fieldIsActive}</span>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={!canSave || save.isPending || uploading}>
            {save.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {t.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TestSendDialog({
  botId, campaign, onClose,
}: { botId: string; campaign: Campaign; onClose: () => void }) {
  const t = useT("botDrip");
  const { toast } = useToast();
  const [target, setTarget] = useState(campaign.audience_mode === "single_chat" ? campaign.audience_value : "");

  const send = useMutation({
    mutationFn: () => customFetch(`/api/bots/${botId}/drip/campaigns/${campaign.id}/test`, {
      method: "POST", body: JSON.stringify({ target }),
    }),
    onSuccess: () => { toast({ title: t.testSent }); onClose(); },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t.testSendTitle}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label>{t.testSendTarget}</Label>
          <Input dir="ltr" placeholder="@username یا chat id" value={target} onChange={(e) => setTarget(e.target.value)} />
          <p className="text-xs text-muted-foreground">{t.testSendHelp}</p>
        </div>
        <DialogFooter>
          <Button onClick={() => send.mutate()} disabled={!target.trim() || send.isPending}>
            {send.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {t.testSendCta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SafetySettings({ botId, config }: { botId: string; config: SafetyConfig }) {
  const t = useT("botDrip");
  const qc = useQueryClient();
  const key = ["bot-drip-settings", botId] as const;
  const save = useMutation({
    mutationFn: (patch: Partial<SafetyConfig>) =>
      customFetch(`/api/bots/${botId}/drip/settings`, { method: "PUT", body: JSON.stringify({ ...config, ...patch }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  return (
    <Card>
      <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label>{t.quietHoursLabel}</Label>
            <Switch checked={config.quiet_hours_enabled} onCheckedChange={(v) => save.mutate({ quiet_hours_enabled: v })} />
          </div>
          <div className="flex items-center gap-2">
            <Input type="time" dir="ltr" className="w-28" value={config.quiet_start}
              onChange={(e) => save.mutate({ quiet_start: e.target.value })} disabled={!config.quiet_hours_enabled} />
            <span className="text-xs text-muted-foreground">{t.until}</span>
            <Input type="time" dir="ltr" className="w-28" value={config.quiet_end}
              onChange={(e) => save.mutate({ quiet_end: e.target.value })} disabled={!config.quiet_hours_enabled} />
          </div>
          <p className="text-xs text-muted-foreground">{t.quietHoursHint}</p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label>{t.frequencyCapLabel}</Label>
            <Switch checked={config.frequency_cap_enabled} onCheckedChange={(v) => save.mutate({ frequency_cap_enabled: v })} />
          </div>
          <Input
            type="number" dir="ltr" className="w-28" min={1} max={1000}
            value={config.max_per_user_per_hour}
            disabled={!config.frequency_cap_enabled}
            onChange={(e) => save.mutate({ max_per_user_per_hour: Math.max(1, Number(e.target.value) || 1) })}
          />
          <p className="text-xs text-muted-foreground">{t.frequencyCapHint}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function DripSection({ bot }: { bot: Bot }) {
  const t = useT("botDrip");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Campaign | null | "new">(null);
  const [testing, setTesting] = useState<Campaign | null>(null);

  const key = ["bot-drip-campaigns", bot.id] as const;
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => customFetch<{ campaigns: Campaign[] }>(`/api/bots/${bot.id}/drip/campaigns`),
  });

  const statsQuery = useQuery({
    queryKey: ["bot-drip-stats", bot.id],
    queryFn: () => customFetch<{ stats: { campaigns: number; active: number; pending: number; sent: number; failed: number } }>(`/api/bots/${bot.id}/drip/stats`),
    enabled: !error,
  });

  const settingsKey = ["bot-drip-settings", bot.id] as const;
  const settingsQuery = useQuery({
    queryKey: settingsKey,
    queryFn: () => customFetch<{ config: SafetyConfig }>(`/api/bots/${bot.id}/drip/settings`),
    enabled: !error,
  });

  const triggers = useTriggerOptions(bot.id);
  const { data: panelsData } = usePanels(bot.id);
  const { data: forms = [] } = useFormOptions(bot.id);

  const activate = useMutation({
    mutationFn: () => customFetch(`/api/bots/${bot.id}/plugins/drip`, { method: "PATCH", body: JSON.stringify({ enabled: true }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bot-plugins", bot.id] }); qc.invalidateQueries({ queryKey: key }); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => customFetch(`/api/bots/${bot.id}/drip/campaigns/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast({ title: t.campaignDeleted }); },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const toggle = useMutation({
    mutationFn: (id: string) => customFetch(`/api/bots/${bot.id}/drip/campaigns/${id}/toggle`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  if (isLoading) {
    return <div className="flex items-center gap-2 p-8 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;
  }

  if (errCode(error) === "plugin_disabled") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <Send className="size-8 text-muted-foreground" />
          <p className="font-semibold">{t.pluginDisabledTitle}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t.pluginDisabledDesc}</p>
          <Button onClick={() => activate.mutate()} disabled={activate.isPending}>
            {activate.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {activate.isPending ? t.activating : t.activatePlugin}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {errCode(error) === "no_sheet" ? t.noSheetYet : errMessage(error, t.errorGeneric)}
      </div>
    );
  }

  const campaigns = data?.campaigns ?? [];
  const stats = statsQuery.data?.stats;

  const scheduleIcon = (s: ScheduleType) => (s === "datetime" ? Clock : s === "recurring" ? Repeat : Zap);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t.sectionDesc}</p>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="me-1.5 size-4" /> {t.newCampaign}
        </Button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Card><CardContent className="p-3 text-center"><p className="text-lg font-semibold">{stats.active}</p><p className="text-xs text-muted-foreground">{t.statActive}</p></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><p className="text-lg font-semibold">{stats.pending}</p><p className="text-xs text-muted-foreground">{t.statPending}</p></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><p className="text-lg font-semibold">{stats.sent}</p><p className="text-xs text-muted-foreground">{t.statSent}</p></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><p className="text-lg font-semibold">{stats.failed}</p><p className="text-xs text-muted-foreground">{t.statFailed}</p></CardContent></Card>
        </div>
      )}

      {settingsQuery.data?.config && <SafetySettings botId={bot.id} config={settingsQuery.data.config} />}

      {campaigns.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{t.noCampaigns}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {campaigns.map((c) => {
            const Icon = scheduleIcon(c.schedule_type);
            return (
              <Card key={c.id}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-medium">
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{c.title}</span>
                        {!c.is_active && <Badge variant="outline">{t.inactiveBadge}</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{scheduleSummary(t, c)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t.statSent}: {c.sent_count.toLocaleString("fa-IR")} · {t.statPending}: {c.queued_count.toLocaleString("fa-IR")}
                      </p>
                    </div>
                    <Switch checked={c.is_active} onCheckedChange={() => toggle.mutate(c.id)} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(c)}>
                      <Pencil className="me-1.5 size-3.5" /> {t.edit}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setTesting(c)}>
                      <FlaskConical className="me-1.5 size-3.5" /> {t.testSendCta}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => remove.mutate(c.id)} disabled={remove.isPending}>
                      <Trash2 className="me-1.5 size-3.5" /> {t.delete}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <CampaignEditor
          botId={bot.id}
          campaign={editing === "new" ? null : editing}
          triggers={triggers}
          panels={panelsData?.panels ?? []}
          forms={forms}
          onClose={() => setEditing(null)}
        />
      )}
      {testing && <TestSendDialog botId={bot.id} campaign={testing} onClose={() => setTesting(null)} />}
    </div>
  );
}
