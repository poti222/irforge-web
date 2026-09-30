import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, CalendarClock, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { getSchoolMe, listCounselorSchedule, createCounselorScheduleSlot, deleteCounselorScheduleSlot } from "@/lib/schools-api";

// همان لیستِ روزهایِ فارسی که admin/programs.tsx استفاده می‌کند.
const DAYS_FA = ["شنبه", "یک‌شنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه"];

/**
 * pages/schools/counselor/schedule.tsx — «برنامه‌ی هفتگی» (فاز ۴، بندِ ۱):
 * زنگ‌هایِ دردسترس‌بودنِ مشاور — رویِ همان جدولِ school_programs (ببینید
 * schema/schoolPrograms.ts). دانش‌آموز همین لیست را به‌صورتِ فقط‌خواندنی در
 * صفحه‌ی «ارتباط با مشاور» می‌بیند.
 */
export default function CounselorSchedulePage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navSchedule);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;

  const { data: slots, isLoading } = useQuery({
    queryKey: ["schools", "counselor-schedule", schoolId, me?.userId],
    queryFn: () => listCounselorSchedule(schoolId!, me!.userId),
    enabled: !!schoolId && !!me?.userId,
  });

  const [dayOfWeek, setDayOfWeek] = useState<string>("0");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!schoolId || !startTime || !endTime) return;
    setSaving(true);
    try {
      await createCounselorScheduleSlot(schoolId, { dayOfWeek, startTime, endTime, note: note.trim() || null });
      await queryClient.invalidateQueries({ queryKey: ["schools", "counselor-schedule", schoolId, me?.userId] });
      setStartTime(""); setEndTime(""); setNote("");
      toast({ title: t.scheduleSaved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.scheduleSaveError, description: err?.data?.error });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!schoolId) return;
    try {
      await deleteCounselorScheduleSlot(schoolId, id);
      await queryClient.invalidateQueries({ queryKey: ["schools", "counselor-schedule", schoolId, me?.userId] });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.scheduleSaveError, description: err?.data?.error });
    }
  }

  if (isLoading) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navSchedule}</h1>
        <p className="text-sm text-muted-foreground">{t.counselorScheduleDescription}</p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t.addScheduleSlotButton}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label>{t.fieldProgramDay}</Label>
              <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DAYS_FA.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t.fieldProgramStart}</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} dir="ltr" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t.fieldProgramEnd}</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} dir="ltr" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t.fieldNote}</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button onClick={handleCreate} disabled={saving || !startTime || !endTime} className="w-fit">
            {saving ? <Loader2 className="me-2 size-4 animate-spin" /> : <Plus className="me-2 size-4" />}
            {t.addScheduleSlotButton}
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 font-medium"><CalendarClock className="size-4" /> {t.scheduleListTitle}</h2>
        {!slots || slots.length === 0 ? (
          <div className="flex h-24 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.scheduleEmpty}</div>
        ) : (
          <div className="flex flex-col gap-2">
            {slots.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{DAYS_FA[Number(s.dayOfWeek)] ?? s.dayOfWeek}</Badge>
                  <span dir="ltr">{s.startTime}–{s.endTime}</span>
                  {s.description && <span className="text-muted-foreground">· {s.description}</span>}
                </div>
                <Button size="sm" variant="ghost" onClick={() => handleDelete(s.id)}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
