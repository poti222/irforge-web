import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, ClipboardCheck, CheckCheck, History, Download, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import {
  getSchoolMe, listSchoolClasses, listClassMembers, listSchoolMembers,
  listClassAttendance, markAttendance, ATTENDANCE_STATUSES, type AttendanceStatus,
  getPreviousAttendanceDate, attendanceExportUrl,
} from "@/lib/schools-api";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** فازِ ۱۰ (بندِ ۱.۲): شمارِ غیبت/تأخیر/درصدِ حضور از رویِ یک بازه‌ی رکوردهای ثبت‌شده — بدونِ اندپوینتِ تازه. */
function computeAttendanceStats(records: { status: AttendanceStatus }[]) {
  const total = records.length;
  const absent = records.filter((r) => r.status === "absent").length;
  const late = records.filter((r) => r.status === "late").length;
  const present = records.filter((r) => r.status === "present" || r.status === "excused").length;
  const rate = total > 0 ? Math.round((present / total) * 100) : null;
  return { total, absent, late, rate };
}

/**
 * pages/schools/teacher/attendance.tsx — «حضور و غیاب» (فاز ۶، بندِ ۱؛ بهبودهایِ
 * فازِ ۱۰): معلم یکی از کلاس‌های خودش و یک تاریخ را انتخاب می‌کند، وضعیتِ هر
 * دانش‌آموزِ روستر را می‌زند و یک‌جا (POST دسته‌جمعی) ذخیره می‌کند. نشانه‌گذاریِ
 * دوباره‌ی همان روز فقط ردیفِ موجود را ویرایش می‌کند (سرور upsert می‌کند).
 * فازِ ۱۰: دو دکمه‌ی میان‌بُر («همه حاضر»، «کپی از روز قبل») + آمارِ هر
 * دانش‌آموز (بازشو) + دانلودِ CSV.
 */
export default function TeacherAttendancePage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navAttendance);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;

  const { data: myClasses, isLoading } = useQuery({
    queryKey: ["schools", "classes", schoolId, "mine"],
    queryFn: () => listSchoolClasses(schoolId!, true),
    enabled: !!schoolId,
  });

  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [date, setDate] = useState<string>(todayIso());
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>({});
  // فازِ ۸: یادداشت/دلیلِ دستی‌ِ معلم به‌ازایِ هر دانش‌آموز — تا زمانی‌که معلم
  // چیزی تایپ نکرده، مقدارِ پیش‌فرض از رکوردِ همین روز (اگر قبلاً ثبت شده)
  // خوانده می‌شود (statusFor هم دقیقاً همین الگو را برایِ وضعیت دارد)، تا
  // ویرایشِ یک روزِ قبلاً ثبت‌شده با یادداشتِ خالی باز نشود.
  const [notes, setNotes] = useState<Record<string, string>>({});

  const { data: roster } = useQuery({
    queryKey: ["schools", "class-members", selectedClassId],
    queryFn: () => listClassMembers(schoolId!, selectedClassId),
    enabled: !!schoolId && !!selectedClassId,
  });
  const { data: members } = useQuery({ queryKey: ["schools", "members", schoolId], queryFn: () => listSchoolMembers(schoolId!), enabled: !!schoolId });
  const { data: existing } = useQuery({
    queryKey: ["schools", "attendance", selectedClassId, date],
    queryFn: () => listClassAttendance(schoolId!, selectedClassId, { date }),
    enabled: !!schoolId && !!selectedClassId && !!date,
  });
  // فازِ ۱۰ (بندِ ۱.۲): بازه‌ی کاملِ همین کلاس برایِ آمار — endpointِ موجود
  // (from/to از قبل پشتیبانی می‌شد)، فقط این‌جا بدونِ فیلترِ تاریخِ خاص صدا
  // زده می‌شود تا کل تاریخچه را بگیریم و خودمان جمع بزنیم.
  const { data: allHistory } = useQuery({
    queryKey: ["schools", "attendance", "all", selectedClassId],
    queryFn: () => listClassAttendance(schoolId!, selectedClassId, {}),
    enabled: !!schoolId && !!selectedClassId && statsOpen,
  });

  const students = (roster ?? []).filter((r) => r.roleInClass === "student");

  function statusFor(studentMemberId: string): AttendanceStatus {
    if (statuses[studentMemberId]) return statuses[studentMemberId];
    const row = (existing ?? []).find((e) => e.studentMemberId === studentMemberId);
    return row?.status ?? "present";
  }

  function noteFor(studentMemberId: string): string {
    if (studentMemberId in notes) return notes[studentMemberId];
    const row = (existing ?? []).find((e) => e.studentMemberId === studentMemberId);
    return row?.note ?? "";
  }

  // فازِ ۱۰ (بندِ ۱.۱): یک‌کلیکی «همه حاضر» — فقط حالتِ فرم را پر می‌کند؛
  // معلم هنوز باید دکمه‌ی ذخیره را بزند.
  function handleMarkAllPresent() {
    const next: Record<string, AttendanceStatus> = {};
    for (const s of students) next[s.schoolMemberId] = "present";
    setStatuses((st) => ({ ...st, ...next }));
  }

  // فازِ ۱۰ (بندِ ۱.۱): «کپی از روز قبل» — نزدیک‌ترین تاریخِ ثبت‌شده‌ی قبل از
  // امروز را پیدا می‌کند، رکوردهایش را می‌خواند و فقط حالتِ فرم را از آن‌ها پر
  // می‌کند (شروعِ کار، نه ارسالِ خودکار — معلم هنوز باید بازبینی/ذخیره کند).
  async function handleCopyPreviousDay() {
    if (!schoolId || !selectedClassId) return;
    setCopying(true);
    try {
      const prev = await getPreviousAttendanceDate(schoolId, selectedClassId, date);
      if (!prev) {
        toast({ title: t.copyPreviousDayNoneFound });
        return;
      }
      const prevRecords = await listClassAttendance(schoolId, selectedClassId, { date: prev.date });
      const nextStatuses: Record<string, AttendanceStatus> = {};
      const nextNotes: Record<string, string> = {};
      for (const r of prevRecords) {
        nextStatuses[r.studentMemberId] = r.status;
        if (r.note) nextNotes[r.studentMemberId] = r.note;
      }
      setStatuses((st) => ({ ...st, ...nextStatuses }));
      setNotes((n) => ({ ...n, ...nextNotes }));
      toast({ title: t.copyPreviousDayApplied });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.attendanceSaveError, description: err?.data?.error });
    } finally {
      setCopying(false);
    }
  }

  async function handleSave() {
    if (!schoolId || !selectedClassId || students.length === 0) return;
    setSaving(true);
    try {
      await markAttendance(schoolId, {
        classId: selectedClassId,
        date,
        entries: students.map((s) => ({
          studentMemberId: s.schoolMemberId,
          status: statusFor(s.schoolMemberId),
          note: noteFor(s.schoolMemberId).trim() || null,
        })),
      });
      await queryClient.invalidateQueries({ queryKey: ["schools", "attendance", selectedClassId, date] });
      await queryClient.invalidateQueries({ queryKey: ["schools", "attendance", "all", selectedClassId] });
      setStatuses({});
      setNotes({});
      toast({ title: t.attendanceSaved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.attendanceSaveError, description: err?.data?.error });
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navAttendance}</h1>
        <p className="text-sm text-muted-foreground">{t.attendancePageDescription}</p>
      </div>

      {!myClasses || myClasses.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.classesEmpty}</div>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-1.5 sm:w-64">
              <Label>{t.fieldClass}</Label>
              <Select value={selectedClassId} onValueChange={setSelectedClassId}>
                <SelectTrigger><SelectValue placeholder={t.selectClassPlaceholder} /></SelectTrigger>
                <SelectContent>
                  {myClasses.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5 sm:w-52">
              <Label>{t.fieldAttendanceDate}</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" />
            </div>
            {selectedClassId && (
              <Button variant="outline" size="sm" onClick={() => window.open(attendanceExportUrl(schoolId!, selectedClassId), "_blank")}>
                <Download className="me-1 size-4" /> {t.exportCsvButton}
              </Button>
            )}
          </div>

          {selectedClassId && (
            <>
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="size-4" /> {t.rosterTitle}</CardTitle></CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {students.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t.rosterEmpty}</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={handleMarkAllPresent}>
                          <CheckCheck className="me-1 size-4" /> {t.markAllPresentButton}
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={handleCopyPreviousDay} disabled={copying}>
                          {copying ? <Loader2 className="me-1 size-4 animate-spin" /> : <History className="me-1 size-4" />}
                          {t.copyPreviousDayButton}
                        </Button>
                      </div>
                      {students.map((s) => {
                        const person = (members ?? []).find((m) => m.id === s.schoolMemberId);
                        const status = statusFor(s.schoolMemberId);
                        return (
                          <div key={s.id} className="flex flex-col gap-2 rounded-md border p-2 sm:flex-row sm:items-center sm:justify-between">
                            <span className="text-sm font-medium sm:w-40 sm:shrink-0">{person?.userName ?? person?.userEmail ?? s.schoolMemberId}</span>
                            <Select value={status} onValueChange={(v) => setStatuses((st) => ({ ...st, [s.schoolMemberId]: v as AttendanceStatus }))}>
                              <SelectTrigger className="w-40 shrink-0"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {ATTENDANCE_STATUSES.map((st) => (
                                  <SelectItem key={st} value={st}>{t[`attendanceStatus_${st}`]}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              value={noteFor(s.schoolMemberId)}
                              onChange={(e) => setNotes((n) => ({ ...n, [s.schoolMemberId]: e.target.value }))}
                              placeholder={t.fieldAttendanceNotePlaceholder}
                              className="sm:flex-1"
                            />
                          </div>
                        );
                      })}
                      <Button onClick={handleSave} disabled={saving} className="w-fit">
                        {saving && <Loader2 className="me-2 size-4 animate-spin" />}
                        {t.saveButton}
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>

              {students.length > 0 && (
                <Collapsible open={statsOpen} onOpenChange={setStatsOpen}>
                  <Card>
                    <CollapsibleTrigger asChild>
                      <CardHeader className="cursor-pointer select-none">
                        <CardTitle className="flex items-center justify-between text-base">
                          <span>{t.attendanceSummaryTitle}</span>
                          <ChevronDown className={`size-4 transition-transform ${statsOpen ? "rotate-180" : ""}`} />
                        </CardTitle>
                      </CardHeader>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent className="flex flex-col gap-2">
                        {!allHistory ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          students.map((s) => {
                            const person = (members ?? []).find((m) => m.id === s.schoolMemberId);
                            const stats = computeAttendanceStats(allHistory.filter((r) => r.studentMemberId === s.schoolMemberId));
                            return (
                              <div key={s.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                                <span className="font-medium">{person?.userName ?? person?.userEmail ?? s.schoolMemberId}</span>
                                <span className="flex items-center gap-3 text-xs text-muted-foreground" dir="ltr">
                                  <span>{t.attendanceSummaryAbsentCount}: {stats.absent}</span>
                                  <span>{t.attendanceSummaryLateCount}: {stats.late}</span>
                                  <span>{t.attendanceSummaryRate}: {stats.rate === null ? "—" : `${stats.rate}%`}</span>
                                </span>
                              </div>
                            );
                          })
                        )}
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
