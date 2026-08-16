/**
 * TabWorkingHours.tsx — ساعت کاری بات.
 * معادل `ap:s:wh_times` در `handlers/admin_panel.py`.
 *
 * ⚠️ نگاشت روزها: `0=دوشنبه … 6=یکشنبه` — دقیقاً همان چیزی که
 * `models.py::WorkingHours` کامنت کرده (`# 0=Monday … 6=Sunday`). این با
 * `Date.getDay()` جاوااسکریپت (که ۰=یکشنبه است) **یکی نیست**؛ تبدیل در
 * `jsDayToBotDay` انجام می‌شود و همان جا تست‌شدنی است.
 */
import { Clock } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { SettingsSaveBar, SettingsError, CachePropagationNotice } from "./SettingsSaveBar";
import { useDraft } from "./useDraft";
import { useSaveWorkingHours, type WorkingHours, type SettingsEnvelope } from "./api";
// ساعت ایران از یک ماژول مشترک می‌آید، نه با حساب دستیِ آفست — دلیلش آنجا
// نوشته شده (باگی که برای هر کاربرِ خارج از تهران ساعت را غلط نشان می‌داد).
import { tehranNow } from "@/lib/tehran-time";

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * آیا الان باز است؟ بازه‌ای که `close < open` باشد (مثلاً ۲۲:۰۰ تا ۰۶:۰۰)
 * شب‌گرد است و باید دو تکه حساب شود.
 */
function isOpenNow(wh: WorkingHours): boolean {
  if (!wh.enabled) return true;
  const { day, minutes } = tehranNow();
  if (!wh.days.includes(day)) return false;
  const open = toMinutes(wh.open_time);
  const close = toMinutes(wh.close_time);
  if (open === close) return true;
  return open < close ? minutes >= open && minutes < close : minutes >= open || minutes < close;
}

const DAY_KEYS = ["dayMon", "dayTue", "dayWed", "dayThu", "dayFri", "daySat", "daySun"] as const;

export function TabWorkingHours({ botId, data }: { botId: string; data: SettingsEnvelope }) {
  const t = useT("botSettings");
  const { toast } = useToast();
  const draft = useDraft<WorkingHours & Record<string, unknown>>(
    `settings:workingHours:${botId}`,
    data.settings.working_hours as WorkingHours & Record<string, unknown>
  );
  const save = useSaveWorkingHours(botId);

  const wh = draft.value as WorkingHours;
  const open = isOpenNow(wh);
  const now = tehranNow();

  function toggleDay(day: number) {
    const next = wh.days.includes(day) ? wh.days.filter((d) => d !== day) : [...wh.days, day];
    draft.set("days", next.sort((a, b) => a - b));
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{t.workingHoursTitle}</CardTitle>
        <CardDescription>{t.workingHoursDesc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
          <div className="min-w-0">
            <Label htmlFor="wh-enabled">{t.workingHoursEnabled}</Label>
            <p className="text-xs text-muted-foreground">{t.workingHoursEnabledHint}</p>
          </div>
          <Switch id="wh-enabled" checked={wh.enabled} onCheckedChange={(v) => draft.set("enabled", v)} />
        </div>

        <div className="space-y-2">
          <Label>{t.workingDays}</Label>
          <div className="flex flex-wrap gap-1.5">
            {DAY_KEYS.map((key, day) => {
              const active = wh.days.includes(day);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleDay(day)}
                  aria-pressed={active}
                  className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {t[key]}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">{t.workingDaysHint}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wh-open">{t.openTime}</Label>
            <Input
              id="wh-open" type="time" dir="ltr"
              value={wh.open_time}
              onChange={(e) => draft.set("open_time", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-close">{t.closeTime}</Label>
            <Input
              id="wh-close" type="time" dir="ltr"
              value={wh.close_time}
              onChange={(e) => draft.set("close_time", e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="wh-msg">{t.closedMessage}</Label>
          <Textarea
            id="wh-msg" rows={2}
            value={wh.closed_message}
            onChange={(e) => draft.set("closed_message", e.target.value)}
          />
        </div>

        {/* پیش‌نمایش زنده — با ساعت ایران، نه ساعت مرورگر کاربر. */}
        <p
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
            open
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
          }`}
        >
          <Clock className="size-4 shrink-0" />
          <span>
            {(open ? t.previewOpen : t.previewClosed).replace("{time}", now.label)}
          </span>
        </p>

        <SettingsError error={save.error} />
        <CachePropagationNotice cacheBust={data.cacheBust} />
        <SettingsSaveBar
          dirty={draft.dirty}
          saving={save.isPending}
          onSave={() => save.mutate(wh, { onSuccess: () => { draft.markSaved(); toast({ title: t.saved }); } })}
          onRevert={draft.reset}
        />
      </CardContent>
    </Card>
  );
}
