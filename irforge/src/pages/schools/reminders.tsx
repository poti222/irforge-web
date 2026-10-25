import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, Loader2, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { getSchoolMe } from "@/lib/schools-api";
import {
  createReminder, deleteReminder, listReminders, reminderRecipients, testReminder, updateReminder,
  type Reminder, type RemindersResponse,
} from "@/lib/schools-reminders-api";

/**
 * pages/schools/reminders.tsx — «یادآورها»: پیامِ تکرارشونده برایِ دانش‌آموزان (روزهایِ هفتهٔ دلخواه × چند ساعت در روز، به وقتِ تهران).
 * بات در تلگرام به پیویِ دانش‌آموزانِ کلاس (و گروه‌هایِ انتخابی) می‌فرستد. مدیر/معاون، معلمِ کلاس و دانش‌آموزِ منتخب می‌توانند بسازند و ویرایش کنند.
 * بک‌اند و قوانینِ دسترسی: api-server/src/routes/schoolReminders.ts + lib/schoolReminders.ts.
 * روزِ هفته: شنبه=۰ … جمعه=۶ (قراردادِ سایت).
 */
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const TIME_PRESETS = ["06:00", "08:00", "12:00", "16:00", "21:00"];
const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));

interface FormState {
  id: string | null;
  classId: string;            // "" = کلِ مدرسه
  title: string;
  message: string;
  weekdays: number[];
  times: string[];
  startDate: string;
  endDate: string;
  skipDates: string[];
  sendDm: boolean;
  groupIds: string[];
  active: boolean;
}
const emptyForm = (classId = ""): FormState => ({
  id: null, classId, title: "", message: "", weekdays: [0, 1, 2, 3, 4], times: ["08:00"], startDate: "", endDate: "", skipDates: [], sendDm: true, groupIds: [], active: true,
});
const fromReminder = (r: Reminder): FormState => ({
  id: r.id, classId: r.classId ?? "", title: r.title, message: r.message, weekdays: r.weekdays, times: r.times, startDate: r.startDate ?? "", endDate: r.endDate ?? "",
  skipDates: r.skipDates, sendDm: r.sendDm, groupIds: r.groupIds, active: r.active,
});

export default function SchoolRemindersPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.remindTitle);
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;
  const key = ["schools", "reminders", schoolId];
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => listReminders(schoolId!), enabled: !!schoolId, refetchInterval: 60_000, retry: false });

  const [form, setForm] = useState<FormState | null>(null);
  const [toDelete, setToDelete] = useState<Reminder | null>(null);
  const [filterClass, setFilterClass] = useState<string>("all");
  const dayNames: string[] = t.remindDayNames ?? [];

  const save = useMutation({
    mutationFn: (f: FormState) => {
      const body = {
        message: f.message, title: f.title, weekdays: f.weekdays, times: f.times, startDate: f.startDate || null, endDate: f.endDate || null,
        skipDates: f.skipDates, sendDm: f.sendDm, groupIds: f.groupIds, active: f.active,
      };
      return f.id ? updateReminder(schoolId!, f.id, body) : createReminder(schoolId!, { ...body, classId: f.classId || null });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setForm(null); toast({ title: t.remindSaved }); },
    onError: (e: any) => toast({ variant: "destructive", title: t.remindFailed, description: e?.data?.error }),
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => updateReminder(schoolId!, id, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: any) => toast({ variant: "destructive", title: t.remindFailed, description: e?.data?.error }),
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteReminder(schoolId!, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setToDelete(null); toast({ title: t.remindDeleted }); },
    onError: (e: any) => toast({ variant: "destructive", title: t.remindFailed, description: e?.data?.error }),
  });
  const test = useMutation({
    mutationFn: (id: string) => testReminder(schoolId!, id),
    onSuccess: () => toast({ title: t.remindTestSent }),
    onError: (e: any) => toast({ variant: "destructive", title: t.remindFailed, description: e?.data?.error }),
  });

  const visible = useMemo(() => {
    const list = data?.reminders ?? [];
    return filterClass === "all" ? list : list.filter((r) => (filterClass === "school" ? r.classId === null : r.classId === filterClass));
  }, [data, filterClass]);

  if (isLoading || !schoolId) return <div className="flex justify-center p-10"><Loader2 className="size-6 animate-spin" /></div>;
  if (error || !data) return <Alert className="m-4"><AlertDescription>{t.remindNoAccess}</AlertDescription></Alert>;

  return (
    <div className="space-y-5 p-4 md:p-6" dir="auto">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="flex items-center gap-2 text-xl font-bold"><AlarmClock className="size-5 text-primary" />{t.remindTitle}</h1>
          <p className="text-sm text-muted-foreground">{t.remindIntro}</p>
          <p className="text-xs text-muted-foreground">{t.remindBotNote}</p>
        </div>
        <Button onClick={() => setForm(emptyForm(data.classes[0]?.id ?? ""))} disabled={data.classes.length === 0 && !data.canSchoolWide}>
          <Plus className="me-1.5 size-4" />{t.remindNew}
        </Button>
      </div>

      {data.classes.length > 1 || data.canSchoolWide ? (
        <div className="flex items-center gap-2">
          <Select value={filterClass} onValueChange={setFilterClass}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.remindAllClasses}</SelectItem>
              {data.canSchoolWide && <SelectItem value="school">{t.remindWholeSchool}</SelectItem>}
              {data.classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {visible.length === 0 && <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">{t.remindEmpty}</CardContent></Card>}

      <div className="grid gap-3">
        {visible.map((r) => (
          <Card key={r.id} className={r.active ? "" : "opacity-70"}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{r.className ?? t.remindWholeSchool}</Badge>
                {r.title && <span className="font-medium">{r.title}</span>}
                <Badge variant={r.active ? "default" : "outline"}>{r.active ? t.remindActive : t.remindPaused}</Badge>
                <div className="ms-auto flex items-center gap-1">
                  <Switch checked={r.active} onCheckedChange={(v) => toggle.mutate({ id: r.id, active: v })} aria-label={t.remindActive} />
                  <Button size="icon" variant="ghost" className="size-8" onClick={() => test.mutate(r.id)} title={t.remindTest} disabled={test.isPending}><Send className="size-4" /></Button>
                  <Button size="icon" variant="ghost" className="size-8" onClick={() => setForm(fromReminder(r))} title={t.remindEdit}><Pencil className="size-4" /></Button>
                  <Button size="icon" variant="ghost" className="size-8 text-destructive" onClick={() => setToDelete(r)} title={t.remindDelete}><Trash2 className="size-4" /></Button>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-sm" dir="auto">{r.message}</p>
              <p className="text-sm font-medium text-primary">{r.scheduleText}</p>
              {r.active && r.nextRuns.length > 0 && (
                <p className="text-xs text-muted-foreground">{t.remindNext}: {r.nextRuns.map((n) => n.label).join(" ‹ ")}</p>
              )}
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {r.groupIds.map((gid) => <Badge key={gid} variant="outline">{data.groups.find((g) => g.id === gid)?.title ?? "—"}</Badge>)}
                {!r.sendDm && <Badge variant="outline">{t.remindNoDm}</Badge>}
                <span>{fill(t.remindBy, { name: r.createdByName })}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {form && <ReminderDialog form={form} setForm={setForm} data={data} schoolId={schoolId} dayNames={dayNames} t={t} saving={save.isPending} onSave={() => save.mutate(form)} />}

      <Dialog open={!!toDelete} onOpenChange={(o) => !o && !del.isPending && setToDelete(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t.remindDeleteConfirm}</DialogTitle><DialogDescription className="line-clamp-3">{toDelete?.message}</DialogDescription></DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setToDelete(null)} disabled={del.isPending}>{t.remindCancel}</Button>
            <Button variant="destructive" onClick={() => toDelete && del.mutate(toDelete.id)} disabled={del.isPending}>{del.isPending && <Loader2 className="me-1.5 size-4 animate-spin" />}{t.remindDelete}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── فرمِ ساخت/ویرایش ───────────────────────────────────────────────────────

function summaryOf(f: FormState, dayNames: string[], t: any): string {
  const days = [...f.weekdays].sort((a, b) => a - b);
  const missing = ALL_DAYS.filter((d) => !days.includes(d));
  const list = (xs: number[]) => xs.map((d) => dayNames[d]).join(t.remindSep ?? "، ");
  let d = "—";
  if (days.length === 7) d = t.remindEveryDay;
  else if (days.length > 0 && missing.length <= 2) d = fill(t.remindEveryDayExcept, { days: list(missing) });
  else if (days.length > 0) d = list(days);
  const times = [...f.times].sort().join(t.remindSep ?? "، ");
  return `${d} — ${times ? fill(t.remindAt, { times }) : "—"}`;
}

function ReminderDialog({ form, setForm, data, schoolId, dayNames, t, saving, onSave }: {
  form: FormState; setForm: (f: FormState | null) => void; data: RemindersResponse; schoolId: string; dayNames: string[]; t: any; saving: boolean; onSave: () => void;
}) {
  const [timeInput, setTimeInput] = useState("08:00");
  const [skipInput, setSkipInput] = useState("");
  const patch = (p: Partial<FormState>) => setForm({ ...form, ...p });
  const stats = useQuery({
    queryKey: ["schools", "reminders", "recipients", schoolId, form.classId],
    queryFn: () => reminderRecipients(schoolId, form.classId || null),
    staleTime: 30_000, retry: false,
  });
  const toggleDay = (d: number) => patch({ weekdays: form.weekdays.includes(d) ? form.weekdays.filter((x) => x !== d) : [...form.weekdays, d].sort((a, b) => a - b) });
  const addTime = (tm: string) => {
    if (!/^\d{2}:\d{2}$/.test(tm) || form.times.includes(tm) || form.times.length >= data.limits.maxTimes) return;
    patch({ times: [...form.times, tm].sort() });
  };
  const presets: { label: string; days: number[] }[] = [
    { label: t.remindPresetEvery, days: ALL_DAYS },
    { label: t.remindPresetNoFri, days: [0, 1, 2, 3, 4, 5] },
    { label: t.remindPresetNoThuFri, days: [0, 1, 2, 3, 4] },
    { label: t.remindPresetFri, days: [6] },
  ];
  const canSave = form.message.trim().length > 0 && form.weekdays.length > 0 && form.times.length > 0 && !saving;

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && setForm(null)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{form.id ? t.remindEdit : t.remindNew}</DialogTitle>
          <DialogDescription>{summaryOf(form, dayNames, t)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {!form.id && (
            <div className="space-y-1.5">
              <Label>{t.remindFieldClass}</Label>
              <Select value={form.classId || "__school__"} onValueChange={(v) => patch({ classId: v === "__school__" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {data.canSchoolWide && <SelectItem value="__school__">{t.remindWholeSchool}</SelectItem>}
                  {data.classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {stats.data && <p className="text-xs text-muted-foreground">{fill(t.remindRecipients, { connected: stats.data.connected, students: stats.data.students })}</p>}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{t.remindFieldMessage}</Label>
            <Textarea value={form.message} onChange={(e) => patch({ message: e.target.value })} rows={3} maxLength={data.limits.maxMessage} placeholder={t.remindMessagePlaceholder} dir="auto" />
            <p className="text-end text-xs text-muted-foreground">{form.message.length}/{data.limits.maxMessage}</p>
          </div>
          <div className="space-y-1.5">
            <Label>{t.remindFieldTitle}</Label>
            <Input value={form.title} onChange={(e) => patch({ title: e.target.value })} maxLength={data.limits.maxTitle} dir="auto" />
          </div>

          <div className="space-y-2">
            <Label>{t.remindFieldDays}</Label>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => <Button key={p.label} type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => patch({ weekdays: p.days })}>{p.label}</Button>)}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {ALL_DAYS.map((d) => (
                <Button key={d} type="button" size="sm" variant={form.weekdays.includes(d) ? "default" : "outline"} className="h-9 px-1 text-xs" onClick={() => toggleDay(d)} aria-pressed={form.weekdays.includes(d)}>
                  {dayNames[d]}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t.remindFieldTimes}</Label>
            <div className="flex flex-wrap gap-1.5">
              {form.times.map((tm) => (
                <Badge key={tm} variant="secondary" className="gap-1 text-sm" dir="ltr">
                  {tm}<button type="button" onClick={() => patch({ times: form.times.filter((x) => x !== tm) })} aria-label="remove"><X className="size-3" /></button>
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input type="time" value={timeInput} onChange={(e) => setTimeInput(e.target.value)} className="w-32" dir="ltr" />
              <Button type="button" size="sm" variant="outline" onClick={() => addTime(timeInput)} disabled={form.times.length >= data.limits.maxTimes}><Plus className="me-1 size-4" />{t.remindAddTime}</Button>
              {TIME_PRESETS.map((p) => <Button key={p} type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => addTime(p)} dir="ltr">{p}</Button>)}
            </div>
            <p className="text-xs text-muted-foreground">{fill(t.remindTimesHint, { max: data.limits.maxTimes })}</p>
          </div>

          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">{t.remindAdvanced}</summary>
            <div className="mt-3 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>{t.remindStart}</Label><Input type="date" value={form.startDate} onChange={(e) => patch({ startDate: e.target.value })} dir="ltr" /></div>
                <div className="space-y-1.5"><Label>{t.remindEnd}</Label><Input type="date" value={form.endDate} onChange={(e) => patch({ endDate: e.target.value })} dir="ltr" /></div>
              </div>
              <div className="space-y-1.5">
                <Label>{t.remindSkip}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {form.skipDates.map((d) => <Badge key={d} variant="outline" className="gap-1" dir="ltr">{d}<button type="button" onClick={() => patch({ skipDates: form.skipDates.filter((x) => x !== d) })}><X className="size-3" /></button></Badge>)}
                </div>
                <div className="flex gap-2">
                  <Input type="date" value={skipInput} onChange={(e) => setSkipInput(e.target.value)} className="w-44" dir="ltr" />
                  <Button type="button" size="sm" variant="outline" disabled={!skipInput || form.skipDates.includes(skipInput)} onClick={() => { patch({ skipDates: [...form.skipDates, skipInput].sort() }); setSkipInput(""); }}>{t.remindAddSkip}</Button>
                </div>
              </div>
            </div>
          </details>

          <div className="space-y-2">
            <Label>{t.remindDelivery}</Label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.sendDm} onCheckedChange={(v) => patch({ sendDm: v === true })} />{t.remindSendDm}</label>
            {data.groups.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t.remindGroups}</p>
                {data.groups.map((g) => (
                  <label key={g.id} className={`flex items-center gap-2 text-sm ${g.canPost ? "" : "opacity-50"}`}>
                    <Checkbox disabled={!g.canPost} checked={form.groupIds.includes(g.id)} onCheckedChange={(v) => patch({ groupIds: v === true ? [...form.groupIds, g.id] : form.groupIds.filter((x) => x !== g.id) })} />
                    {g.title}{!g.canPost && <span className="text-xs">({t.remindGroupDisabled})</span>}
                  </label>
                ))}
              </div>
            )}
            {!form.sendDm && form.groupIds.length === 0 && <p className="text-xs text-amber-600 dark:text-amber-400">{t.remindNoTarget}</p>}
          </div>

          <label className="flex items-center gap-2 text-sm"><Switch checked={form.active} onCheckedChange={(v) => patch({ active: v })} />{t.remindActive}</label>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => setForm(null)} disabled={saving}>{t.remindCancel}</Button>
          <Button onClick={onSave} disabled={!canSave}>{saving && <Loader2 className="me-1.5 size-4 animate-spin" />}{t.remindSave}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
