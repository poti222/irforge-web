/**
 * BookingSection.tsx — IRFORGE_PROMPT_V3 Phase 17
 * ─────────────────────────────────────────────────────────────────────────────
 * جایگزینِ `<PluginSection plugin="booking" />` قدیمی. آن نسخه فقط CRUD
 * عمومیِ سه تب شیت‌مانند بود؛ این نسخه چهار تبِ اختصاصی دارد چون فاز ۱۷ مدل
 * داده را عوض کرد (بازه‌ها دیگر از قبل ساخته نمی‌شوند، از برنامه‌ی کاری
 * مشتق می‌شوند — `bookingAvailability.ts`/`plugins/booking/availability.py`):
 *
 *   ۱. برنامه‌ی کاری   — ساعات هفتگی + قوانین (مدت اسلات، مهلت لغو، سقفِ روزانه، ...)
 *   ۲. تقویم هفتگی     — شبکه‌ی ساعت×روز، رنگی (سبز/کهربایی/قرمز)، کلیک روی
 *                        یک روز یعنی تنظیم استثنا برای همان تاریخ
 *   ۳. رزروها          — فیلتر/تأیید/رد/لغو/انجام‌شده/عدم‌حضور + خروجی CSV
 *   ۴. سرویس‌ها        — همان CRUD عمومیِ قبلی (`PluginCollectionTable`)،
 *                        چون فقط پاکیزه‌سازیِ جزئی لازم داشت، نه بازنویسی
 *
 * محدودیتِ مستندشده‌ی تقویم هفتگی: رنگ هر ساعت فقط از اسلات‌های واقعاً
 * برگشته از `/booking/availability` تعیین می‌شود، و آن اندپوینت — طبق طراحیِ
 * خودِ الگوریتم — اسلاتِ پر را دقیقاً مثل اسلاتِ بیرون از بازه‌ی کاری اصلاً
 * برنمی‌گرداند (نه غیرفعال، بلکه پنهان). یعنی این شبکه فرقِ «پر» و «تعطیل»
 * را با یک رنگ (قرمز) نشان می‌دهد، نه دو رنگِ جدا — ساده‌سازیِ عمدی، نه باگ.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import {
  CalendarClock, Download, Loader2, MapPin, Plus, Search, Trash2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";
import { PluginCollectionTable } from "@/components/bots/plugins/PluginCollectionTable";
import { formatJalali } from "@/lib/tehran-time";

// ── قالب‌های داده — همتای lib/bookingStore.ts سمت سرور ──────────────────

type TimeWindow = { from: string; to: string };
type WeekSchedule = Partial<Record<string, TimeWindow[]>>;

type BookingSchedule = {
  week: WeekSchedule;
  slot_minutes: number;
  buffer_minutes: number;
  lead_time_minutes: number;
  daily_cap: number;
  default_capacity: number;
  horizon_days: number;
  timezone: string;
  cancel_cutoff_hours: number;
};

type BookingException = {
  date: string;
  closed?: boolean;
  windows?: TimeWindow[];
  capacity?: number | null;
  note?: string;
};

type AvailableSlot = { start: string; end: string; capacity: number; booked: number; free: number };

type BookingReservation = {
  id: string;
  slot_id: string;
  service_id: string;
  user_id: string;
  username?: string;
  status: string;
  customer_name?: string;
  customer_phone?: string;
  customer_lat?: number | null;
  customer_lng?: number | null;
  note?: string;
  no_show?: boolean;
  created_at?: string;
};

const WEEKDAYS = ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday"] as const;

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}

/** آخرین شنبه‌ی روی/قبل از امروز — شروعِ هفته‌ی نمایشیِ تقویم. */
function startOfWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const isoDow = d.getUTCDay() || 7; // Sun=0 -> 7
  const sinceSaturday = (isoDow + 1) % 7; // Saturday=6 -> 0
  d.setUTCDate(d.getUTCDate() - sinceSaturday);
  return d.toISOString().slice(0, 10);
}
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/**
 * تاریخِ «YYYY-MM-DD» میلادی → همان تاریخ شمسی، برای نمایش کنار میلادی.
 * بات خودش تقویمِ رزرو را کاملاً شمسی به مشتری نشان می‌دهد
 * (`plugins/booking/handlers.py`)؛ این تب مدیریتی روی سایت تا امروز فقط
 * میلادی داشت — برای ادمین فارسی‌زبان یعنی تاریخِ خودِ بات را نمی‌شناخت.
 */
function jalaliOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return formatJalali(y, m, d);
}

// ═══════════════════════════════════════════════════════════════════════
//  تب ۱ — برنامه‌ی کاری
// ═══════════════════════════════════════════════════════════════════════

function ScheduleTab({ botId }: { botId: string }) {
  const t = useT("botBooking");
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["bot-booking-schedule", botId] as const;

  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => customFetch<{ schedule: BookingSchedule }>(`/api/bots/${botId}/booking/schedule`),
  });

  const [draft, setDraft] = useState<BookingSchedule | null>(null);
  const schedule = draft ?? data?.schedule ?? null;

  const save = useMutation({
    mutationFn: (next: BookingSchedule) =>
      customFetch<{ schedule: BookingSchedule }>(`/api/bots/${botId}/booking/schedule`, {
        method: "PUT",
        body: JSON.stringify(next),
      }),
    onSuccess: (result) => {
      qc.setQueryData(key, result);
      setDraft(null);
      toast({ title: t.scheduleSaved });
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  if (isLoading || !schedule) {
    if (error) return <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{errMessage(error, t.errorGeneric)}</p>;
    return <div className="flex items-center gap-2 p-8 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;
  }

  function patch(changes: Partial<BookingSchedule>) {
    setDraft({ ...schedule!, ...changes });
  }
  function patchDay(day: string, windows: TimeWindow[]) {
    patch({ week: { ...schedule!.week, [day]: windows } });
  }

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-muted-foreground">{t.scheduleDesc}</p>

      <div className="space-y-2">
        {WEEKDAYS.map((day) => {
          const windows = schedule.week[day] ?? [];
          const open = windows.length > 0;
          return (
            <div key={day} className="rounded-md border p-3">
              <div className="flex items-center gap-3">
                <Switch
                  checked={open}
                  onCheckedChange={(checked) => patchDay(day, checked ? [{ from: "09:00", to: "18:00" }] : [])}
                />
                <span className="w-24 shrink-0 font-medium">{t[`day_${day}` as keyof typeof t] as string}</span>
                {!open && <span className="text-sm text-muted-foreground">{t.dayClosed}</span>}
              </div>
              {open && (
                <div className="mt-2 space-y-2 ps-11">
                  {windows.map((w, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        type="time"
                        className="w-32"
                        value={w.from}
                        onChange={(e) => patchDay(day, windows.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}
                      />
                      <span className="text-muted-foreground">–</span>
                      <Input
                        type="time"
                        className="w-32"
                        value={w.to}
                        onChange={(e) => patchDay(day, windows.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}
                      />
                      <Button variant="ghost" size="icon" onClick={() => patchDay(day, windows.filter((_, j) => j !== i))}>
                        <X className="size-4" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => patchDay(day, [...windows, { from: "09:00", to: "18:00" }])}>
                    <Plus className="me-1.5 size-3.5" /> {t.addWindow}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {([
          ["slot_minutes", t.slotMinutes, 1],
          ["buffer_minutes", t.bufferMinutes, 0],
          ["lead_time_minutes", t.leadTimeMinutes, 0],
          ["daily_cap", t.dailyCap, 0],
          ["default_capacity", t.defaultCapacity, 1],
          ["horizon_days", t.horizonDays, 1],
          ["cancel_cutoff_hours", t.cancelCutoffHours, 0],
        ] as const).map(([field, label, min]) => (
          <div key={field} className="space-y-1">
            <Label>{label}</Label>
            <Input
              type="number"
              min={min}
              value={schedule[field]}
              onChange={(e) => patch({ [field]: Math.max(min, Number(e.target.value) || 0) } as Partial<BookingSchedule>)}
            />
          </div>
        ))}
        <div className="space-y-1">
          <Label>{t.timezone}</Label>
          <Input value={schedule.timezone} onChange={(e) => patch({ timezone: e.target.value })} />
        </div>
      </div>

      <Button onClick={() => save.mutate(schedule)} disabled={save.isPending}>
        {save.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
        {t.saveSchedule}
      </Button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  تب ۲ — تقویم هفتگی
// ═══════════════════════════════════════════════════════════════════════

function hourRangeFromWeek(week: WeekSchedule): [number, number] {
  let min = 24, max = 0;
  for (const windows of Object.values(week ?? {})) {
    for (const w of windows ?? []) {
      const [fh] = w.from.split(":").map(Number);
      const [th, tm] = w.to.split(":").map(Number);
      min = Math.min(min, fh);
      max = Math.max(max, tm > 0 ? th + 1 : th);
    }
  }
  if (min >= max) return [8, 20];
  return [min, Math.min(24, max)];
}

type CellStatus = "open" | "partial" | "closed";

function cellClass(status: CellStatus): string {
  if (status === "open") return "border-emerald-500/40 bg-emerald-500/15";
  if (status === "partial") return "border-amber-500/40 bg-amber-500/15";
  return "border-transparent bg-muted/40";
}

function ExceptionDialog({
  botId, date, existing, onClose,
}: { botId: string; date: string; existing: BookingException | null; onClose: () => void }) {
  const t = useT("botBooking");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [closed, setClosed] = useState(existing?.closed ?? false);
  const [windows, setWindows] = useState<TimeWindow[]>(existing?.windows ?? []);
  const [note, setNote] = useState(existing?.note ?? "");

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["bot-booking-exceptions", botId] });
    qc.invalidateQueries({ queryKey: ["bot-booking-availability", botId] });
  }

  const save = useMutation({
    mutationFn: () =>
      customFetch(`/api/bots/${botId}/booking/exceptions/${date}`, {
        method: "PUT",
        body: JSON.stringify({ closed, windows, note }),
      }),
    onSuccess: () => { invalidate(); toast({ title: t.exceptionSaved }); onClose(); },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const clear = useMutation({
    mutationFn: () => customFetch(`/api/bots/${botId}/booking/exceptions/${date}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast({ title: t.exceptionCleared }); onClose(); },
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {jalaliOf(date)} <span dir="ltr" className="text-sm font-normal text-muted-foreground">({date})</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch checked={closed} onCheckedChange={setClosed} />
            <span>{t.markDayClosed}</span>
          </div>
          {!closed && (
            <div className="space-y-2">
              <Label>{t.customWindowsLabel}</Label>
              <p className="text-xs text-muted-foreground">{t.customWindowsHelp}</p>
              {windows.map((w, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input type="time" className="w-32" value={w.from}
                    onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
                  <span className="text-muted-foreground">–</span>
                  <Input type="time" className="w-32" value={w.to}
                    onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
                  <Button variant="ghost" size="icon" onClick={() => setWindows(windows.filter((_, j) => j !== i))}>
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setWindows([...windows, { from: "09:00", to: "18:00" }])}>
                <Plus className="me-1.5 size-3.5" /> {t.addWindow}
              </Button>
            </div>
          )}
          <div className="space-y-1">
            <Label>{t.exceptionNote}</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          {existing && (
            <Button variant="ghost" onClick={() => clear.mutate()} disabled={clear.isPending}>
              <Trash2 className="me-1.5 size-4" /> {t.clearException}
            </Button>
          )}
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {t.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CalendarTab({ botId }: { botId: string }) {
  const t = useT("botBooking");
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [editingDate, setEditingDate] = useState<string | null>(null);

  const scheduleQuery = useQuery({
    queryKey: ["bot-booking-schedule", botId],
    queryFn: () => customFetch<{ schedule: BookingSchedule }>(`/api/bots/${botId}/booking/schedule`),
  });
  const availabilityQuery = useQuery({
    queryKey: ["bot-booking-availability", botId, weekStart],
    queryFn: () =>
      customFetch<{ slots: Record<string, AvailableSlot[]> }>(
        `/api/bots/${botId}/booking/availability?start=${weekStart}&days=7`,
      ),
  });
  const exceptionsQuery = useQuery({
    queryKey: ["bot-booking-exceptions", botId],
    queryFn: () => customFetch<{ exceptions: BookingException[] }>(`/api/bots/${botId}/booking/exceptions`),
  });

  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const [minHour, maxHour] = hourRangeFromWeek(scheduleQuery.data?.schedule.week ?? {});
  const hours = useMemo(() => Array.from({ length: Math.max(1, maxHour - minHour) }, (_, i) => minHour + i), [minHour, maxHour]);

  if (scheduleQuery.isLoading || availabilityQuery.isLoading) {
    return <div className="flex items-center gap-2 p-8 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;
  }

  const slotsByDate = availabilityQuery.data?.slots ?? {};
  const exceptionByDate = new Map((exceptionsQuery.data?.exceptions ?? []).map((e) => [e.date, e]));

  function statusFor(date: string, hour: number): CellStatus {
    const slots = slotsByDate[date] ?? [];
    const match = slots.find((s) => Number(s.start.slice(11, 13)) === hour);
    if (!match) return "closed";
    return match.free === match.capacity ? "open" : "partial";
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t.calendarDesc}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>{t.prevWeek}</Button>
        <span className="text-sm font-medium">
          {jalaliOf(dates[0])} — {jalaliOf(dates[6])}
          <span dir="ltr" className="ms-1.5 text-xs font-normal text-muted-foreground">
            ({dates[0]} — {dates[6]})
          </span>
        </span>
        <Button variant="outline" size="sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>{t.nextWeek}</Button>
        <div className="ms-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full bg-emerald-500" /> {t.legendOpen}</span>
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full bg-amber-500" /> {t.legendPartial}</span>
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full bg-muted-foreground/40" /> {t.legendClosed}</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="w-16 border-b p-2" />
              {dates.map((date) => {
                const exc = exceptionByDate.get(date);
                return (
                  <th key={date} className="border-b border-s p-2 text-center">
                    <button
                      type="button"
                      onClick={() => setEditingDate(date)}
                      className="flex w-full flex-col items-center gap-0.5 rounded p-1 hover:bg-muted/60"
                    >
                      <span className="font-medium">{jalaliOf(date).slice(5)}</span>
                      <span dir="ltr" className="text-[10px] text-muted-foreground">{date.slice(5)}</span>
                      {exc?.closed && <Badge variant="destructive" className="text-[10px]">{t.dayClosed}</Badge>}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {hours.map((hour) => (
              <tr key={hour}>
                <td dir="ltr" className="border-e p-2 text-center text-muted-foreground">{String(hour).padStart(2, "0")}:00</td>
                {dates.map((date) => (
                  <td key={date} className={`border-s p-1 text-center ${cellClass(statusFor(date, hour))}`}>
                    <button type="button" className="block h-6 w-full" onClick={() => setEditingDate(date)} title={date} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingDate && (
        <ExceptionDialog
          botId={botId}
          date={editingDate}
          existing={exceptionByDate.get(editingDate) ?? null}
          onClose={() => setEditingDate(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  تب ۳ — رزروها
// ═══════════════════════════════════════════════════════════════════════

const STATUSES = ["pending", "confirmed", "canceled", "done", "overbooked"] as const;

function ReservationsTab({ botId }: { botId: string }) {
  const t = useT("botBooking");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");

  const key = ["bot-booking-reservations", botId, status, search] as const;
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () =>
      customFetch<{ reservations: BookingReservation[] }>(
        `/api/bots/${botId}/booking/reservations?status=${status}&search=${encodeURIComponent(search)}`,
      ),
  });

  const servicesQuery = useQuery({
    queryKey: ["bot-plugin-data", botId, "booking-services"],
    queryFn: () => customFetch<{ records: Array<{ id: string; title?: string }> }>(`/api/bots/${botId}/plugin-data/booking-services`),
  });
  const serviceTitle = useMemo(() => {
    const map = new Map((servicesQuery.data?.records ?? []).map((r) => [r.id, r.title || r.id]));
    return (id: string) => map.get(id) ?? id;
  }, [servicesQuery.data]);

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      customFetch(`/api/bots/${botId}/booking/reservations/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast({ title: t.reservationUpdated }); },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  if (isLoading) return <div className="flex items-center gap-2 p-8 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;
  if (error) return <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{errMessage(error, t.errorGeneric)}</p>;

  const reservations = data?.reservations ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 ms-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="ps-8" placeholder={t.searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-auto min-w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.filterAll}</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{t[`status_${s}` as keyof typeof t] as string}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" asChild>
          <a href={`/api/bots/${botId}/booking/reservations?status=${status}&search=${encodeURIComponent(search)}&format=csv`} target="_blank" rel="noreferrer">
            <Download className="me-1.5 size-4" /> {t.exportCsv}
          </a>
        </Button>
      </div>

      {reservations.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{t.noReservations}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.colCustomer}</TableHead>
              <TableHead>{t.colService}</TableHead>
              <TableHead>{t.colStatus}</TableHead>
              <TableHead>{t.colNote}</TableHead>
              <TableHead className="text-end">{t.colActions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reservations.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <div className="font-medium">{r.customer_name || "—"}</div>
                  <div dir="ltr" className="text-xs text-muted-foreground">{r.customer_phone || r.user_id}</div>
                  {r.customer_lat != null && r.customer_lng != null && (
                    <a
                      dir="ltr"
                      href={`https://www.google.com/maps?q=${r.customer_lat},${r.customer_lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-0.5 flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <MapPin className="size-3" /> {t.customerLocation}
                    </a>
                  )}
                </TableCell>
                <TableCell>{serviceTitle(r.service_id)}</TableCell>
                <TableCell>
                  <Badge variant={r.status === "overbooked" ? "destructive" : r.status === "canceled" ? "secondary" : "default"}>
                    {t[`status_${r.status}` as keyof typeof t] as string ?? r.status}
                  </Badge>
                  {r.no_show && <Badge variant="outline" className="ms-1">{t.noShowBadge}</Badge>}
                </TableCell>
                <TableCell className="max-w-48 truncate text-muted-foreground">{r.note}</TableCell>
                <TableCell className="text-end">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {(r.status === "pending" || r.status === "overbooked") && (
                      <Button size="sm" variant="outline" onClick={() => patch.mutate({ id: r.id, body: { status: "confirmed" } })}>{t.actionConfirm}</Button>
                    )}
                    {r.status !== "canceled" && r.status !== "done" && (
                      <Button size="sm" variant="outline" onClick={() => patch.mutate({ id: r.id, body: { status: "canceled" } })}>{t.actionCancel}</Button>
                    )}
                    {r.status === "confirmed" && !r.no_show && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => patch.mutate({ id: r.id, body: { status: "done" } })}>{t.actionDone}</Button>
                        <Button size="sm" variant="outline" onClick={() => patch.mutate({ id: r.id, body: { no_show: true } })}>{t.actionNoShow}</Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  ریشه
// ═══════════════════════════════════════════════════════════════════════

export function BookingSection({ bot }: { bot: Bot }) {
  const t = useT("botBooking");
  const { toast } = useToast();
  const qc = useQueryClient();

  const probe = useQuery({
    queryKey: ["bot-booking-schedule", bot.id],
    queryFn: () => customFetch<{ schedule: BookingSchedule }>(`/api/bots/${bot.id}/booking/schedule`),
  });

  const activate = useMutation({
    mutationFn: () => customFetch(`/api/bots/${bot.id}/plugins/booking`, { method: "PATCH", body: JSON.stringify({ enabled: true }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-plugins", bot.id] });
      qc.invalidateQueries({ queryKey: ["bot-booking-schedule", bot.id] });
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  if (probe.isLoading) {
    return <div className="flex items-center gap-2 p-8 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;
  }

  if (errCode(probe.error) === "plugin_disabled") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <CalendarClock className="size-8 text-muted-foreground" />
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

  if (probe.error) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {errCode(probe.error) === "no_sheet" ? t.noSheetYet : errMessage(probe.error, t.errorGeneric)}
      </div>
    );
  }

  return (
    <Tabs defaultValue="schedule" className="space-y-4">
      <TabsList className="flex-wrap">
        <TabsTrigger value="schedule">{t.tabSchedule}</TabsTrigger>
        <TabsTrigger value="calendar">{t.tabCalendar}</TabsTrigger>
        <TabsTrigger value="reservations">{t.tabReservations}</TabsTrigger>
        <TabsTrigger value="services">{t.tabServices}</TabsTrigger>
      </TabsList>
      <TabsContent value="schedule"><ScheduleTab botId={bot.id} /></TabsContent>
      <TabsContent value="calendar"><CalendarTab botId={bot.id} /></TabsContent>
      <TabsContent value="reservations"><ReservationsTab botId={bot.id} /></TabsContent>
      <TabsContent value="services"><PluginCollectionTable botId={bot.id} collection="booking-services" /></TabsContent>
    </Tabs>
  );
}
