import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Copy, Eraser, Save, CalendarClock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { useViewedSchoolId } from "@/hooks/use-viewed-school";
import {
  getSchoolMe, listSchoolClasses, listClassMembers, listSchoolMembers, listSchoolSubjects,
  getClassTimetable, replaceTimetableDay, copyTimetableDay, listSchoolPrograms, deleteSchoolProgram,
  type TimetableSlot, type TimetableRowError, type TimetableRowInput,
} from "@/lib/schools-api";
import { normalizeTime, toMinutes, fromMinutes } from "@/lib/timetable";

/**
 * pages/schools/admin/programs.tsx — «مدیریت برنامه‌ها» = ویرایشگرِ برنامه‌یِ هفتگیِ هر کلاس.
 * هر روز یک «مجموعه‌یِ زنگ» است که با یک درخواستِ اتمیک (PUT .../days/:day) جایگزین می‌شود؛ تا ذخیره نشده فقط پیش‌نویسِ
 * محلی است و تغییرِ کلاس/روز آن را نگه می‌دارد. جدولِ قدیمیِ school_programs فقط به‌صورتِ فهرستِ پایین‌صفحه می‌ماند.
 */
interface Row { key: string; startTime: string; endTime: string; subject: string; custom: boolean; teacherUserId: string; note: string }
const OTHER = "__other";
let keySeq = 0;
const newKey = () => `r${++keySeq}`;
const fromSlot = (s: TimetableSlot): Row => ({ key: s.id, startTime: s.startTime, endTime: s.endTime, subject: s.subject, custom: false, teacherUserId: s.teacherUserId ?? "", note: s.note ?? "" });

/** خطایِ محلیِ هر ردیف (همان قواعدِ سرور تا کاربر قبل از ذخیره ببیند). */
function localErrors(rows: Row[], t: any): Record<string, string> {
  const out: Record<string, string> = {};
  const lbl = (r: Row) => `«${r.subject}» (${r.startTime}–${r.endTime})`;
  rows.forEach((r, i) => {
    const s = normalizeTime(r.startTime), e = normalizeTime(r.endTime);
    if (!s || !e) { out[r.key] = t.ttErrBadTime; return; }
    if (e <= s) { out[r.key] = t.ttErrEndBeforeStart; return; }
    if (!r.subject.trim()) { out[r.key] = t.ttErrSubject; return; }
    for (let j = 0; j < i; j++) {
      const o = rows[j], os = normalizeTime(o.startTime), oe = normalizeTime(o.endTime);
      if (os && oe && s < oe && os < e) { out[r.key] = t.ttErrOverlap.replace("{label}", lbl(o)); return; }
    }
  });
  return out;
}

export default function SchoolProgramsPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navProgramManagement);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { lang } = useLanguage();
  const dayNames = [0, 1, 2, 3, 4, 5, 6].map((i) => t[`ttDay${i}`] as string);

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = useViewedSchoolId(me?.schoolId);
  const canWrite = me?.role === "admin" || me?.role === "deputy" || me?.role === "deputy_discipline" || !!me?.isSuperAdmin;

  const { data: classes, isLoading: classesLoading } = useQuery({ queryKey: ["schools", "classes", schoolId], queryFn: () => listSchoolClasses(schoolId!), enabled: !!schoolId });
  const [classId, setClassId] = useState<string>("");
  useEffect(() => { if (!classId && classes && classes.length) setClassId(classes[0].id); }, [classes, classId]);
  const [day, setDay] = useState(0);

  const { data: week, isLoading: weekLoading } = useQuery({
    queryKey: ["schools", "timetable", schoolId, classId],
    queryFn: () => getClassTimetable(schoolId!, classId),
    enabled: !!schoolId && !!classId,
  });
  const { data: subjects } = useQuery({ queryKey: ["schools", "subjects", schoolId], queryFn: () => listSchoolSubjects(schoolId!), enabled: !!schoolId });
  const { data: classMembers } = useQuery({ queryKey: ["schools", "classMembers", schoolId, classId], queryFn: () => listClassMembers(schoolId!, classId), enabled: !!schoolId && !!classId });
  const { data: members } = useQuery({ queryKey: ["schools", "members", schoolId], queryFn: () => listSchoolMembers(schoolId!), enabled: !!schoolId });
  // فقط معلم‌هایِ همین کلاس (سرور هم همین را اعمال می‌کند).
  const teachers = useMemo(() => {
    const ids = new Set((classMembers ?? []).filter((m) => m.roleInClass === "teacher").map((m) => m.schoolMemberId));
    return (members ?? []).filter((m) => ids.has(m.id)).map((m) => ({ userId: m.userId, name: m.userName || m.userEmail || m.userId }));
  }, [classMembers, members]);

  const serverDays = useMemo(() => {
    const by: Record<number, TimetableSlot[]> = {};
    (week?.slots ?? []).forEach((s) => { (by[s.dayOfWeek] ??= []).push(s); });
    return by;
  }, [week]);

  // پیش‌نویسِ هر (کلاس، روز) — تا ذخیره‌نشده نگه داشته می‌شود.
  const [drafts, setDrafts] = useState<Record<string, Row[]>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, Record<string, string>>>({});
  const [gap, setGap] = useState("0");
  const [saving, setSaving] = useState(false);
  const dk = `${classId}:${day}`;
  const rows: Row[] = drafts[dk] ?? (serverDays[day] ?? []).map(fromSlot);
  const dirty = dk in drafts;
  const subjectNames = (subjects ?? []).map((s) => s.name);
  const presetNames = [t.ttBreak, t.ttPrayer, t.ttLunch];
  const errors = { ...localErrors(rows, t), ...(rowErrors[dk] ?? {}) };

  const setRows = (next: Row[]) => {
    setDrafts((d) => ({ ...d, [dk]: next }));
    setRowErrors((e) => { const { [dk]: _, ...rest } = e; return rest; });
  };
  const patchRow = (key: string, patch: Partial<Row>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function addRow() {
    const last = [...rows].sort((a, b) => a.startTime.localeCompare(b.startTime)).at(-1);
    const lastEnd = last && normalizeTime(last.endTime);
    const lastStart = last && normalizeTime(last.startTime);
    const start = lastEnd ? fromMinutes(toMinutes(lastEnd) + Number(gap)) : "08:00";
    const dur = lastStart && lastEnd ? Math.max(30, toMinutes(lastEnd) - toMinutes(lastStart)) : 60;
    const end = fromMinutes(toMinutes(start) + dur);
    setRows([...rows, { key: newKey(), startTime: start, endTime: end, subject: "", custom: false, teacherUserId: "", note: "" }]);
  }

  async function save() {
    if (!schoolId || !classId) return;
    if (Object.keys(localErrors(rows, t)).length) { toast({ variant: "destructive", title: t.ttFixErrors }); return; }
    setSaving(true);
    try {
      const payload: TimetableRowInput[] = rows.map((r) => ({ startTime: normalizeTime(r.startTime)!, endTime: normalizeTime(r.endTime)!, subject: r.subject.trim(), teacherUserId: r.teacherUserId || null, note: r.note.trim() || null }));
      await replaceTimetableDay(schoolId, classId, day, payload);
      await queryClient.invalidateQueries({ queryKey: ["schools", "timetable", schoolId, classId] });
      setDrafts((d) => { const { [dk]: _, ...rest } = d; return rest; });
      toast({ title: t.ttSaved });
    } catch (err: any) {
      const re: TimetableRowError[] | undefined = err?.data?.rowErrors;
      if (re?.length) {
        // خطایِ سرور به ردیفِ همان index چسبانده می‌شود (ردیف‌ها همان ترتیبِ ارسال‌اند).
        const map: Record<string, string> = {};
        for (const e of re) {
          const row = rows[e.index];
          if (!row) continue;
          map[row.key] = e.code === "teacher_not_in_class" ? t.ttErrTeacherNotInClass : e.code === "bad_time" ? t.ttErrBadTime : e.code === "end_before_start" ? t.ttErrEndBeforeStart : e.code === "subject_required" ? t.ttErrSubject : e.message;
        }
        setRowErrors((x) => ({ ...x, [dk]: map }));
        toast({ variant: "destructive", title: t.ttFixErrors });
      } else {
        toast({ variant: "destructive", title: t.ttSaveError, description: err?.data?.error });
      }
    } finally {
      setSaving(false);
    }
  }

  async function clearDay() {
    if (!schoolId || !classId || !window.confirm(t.ttClearConfirm)) return;
    setSaving(true);
    try {
      await replaceTimetableDay(schoolId, classId, day, []);
      await queryClient.invalidateQueries({ queryKey: ["schools", "timetable", schoolId, classId] });
      setDrafts((d) => { const { [dk]: _, ...rest } = d; return rest; });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.ttSaveError, description: err?.data?.error });
    } finally { setSaving(false); }
  }

  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTo, setCopyTo] = useState<number[]>([]);
  async function doCopy() {
    if (!schoolId || !classId || !copyTo.length) return;
    setSaving(true);
    try {
      await copyTimetableDay(schoolId, classId, day, copyTo);
      await queryClient.invalidateQueries({ queryKey: ["schools", "timetable", schoolId, classId] });
      // پیش‌نویسِ روزهایِ مقصد دیگر معتبر نیست.
      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !copyTo.some((x) => k === `${classId}:${x}`))));
      setCopyOpen(false); setCopyTo([]);
      toast({ title: t.ttCopied });
    } catch (err: any) {
      const re: TimetableRowError[] | undefined = err?.data?.rowErrors;
      toast({ variant: "destructive", title: t.ttSaveError, description: re?.[0]?.message ?? err?.data?.error });
    } finally { setSaving(false); }
  }

  // برنامه‌هایِ قدیمیِ school_programs (فقط مشاهده/حذف؛ مشاور هنوز از همان جدول می‌خواند).
  const { data: legacy } = useQuery({ queryKey: ["schools", "programs", schoolId], queryFn: () => listSchoolPrograms(schoolId!), enabled: !!schoolId });
  const legacyVisible = legacy ?? [];

  if (classesLoading) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navProgramManagement}</h1>
        <p className="text-sm text-muted-foreground">{t.ttDescription}</p>
      </div>

      {!classes || classes.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{t.ttNoClasses}</div>
      ) : (
        <>
          <div className="flex max-w-xs flex-col gap-1.5">
            <Label>{t.ttPickClass}</Label>
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger data-testid="tt-class-select"><SelectValue /></SelectTrigger>
              <SelectContent>{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist">
            {dayNames.map((name, i) => {
              const has = (serverDays[i]?.length ?? 0) > 0;
              const isDirty = `${classId}:${i}` in drafts;
              return (
                <Button key={i} role="tab" aria-selected={day === i} size="sm" variant={day === i ? "default" : "outline"} onClick={() => setDay(i)} className="shrink-0" data-testid={`tt-day-${i}`}>
                  {name}
                  {(has || isDirty) && <span className={`ms-1.5 size-1.5 rounded-full ${isDirty ? "bg-amber-500" : day === i ? "bg-primary-foreground" : "bg-primary"}`} />}
                </Button>
              );
            })}
          </div>

          {weekLoading ? <Loader2 className="size-5 animate-spin" /> : (
            <div className="flex flex-col gap-2">
              {rows.length === 0 && <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{t.ttEmptyDay}</div>}
              {rows.map((r, idx) => {
                const subjectValue = r.custom ? OTHER : (subjectNames.includes(r.subject) || presetNames.includes(r.subject)) ? r.subject : r.subject ? OTHER : "";
                const err = errors[r.key];
                return (
                  <Card key={r.key} className={err ? "border-destructive" : undefined} data-testid={`tt-row-${idx}`}>
                    <CardContent className="flex flex-col gap-2 p-3">
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[7rem_7rem_1fr_1fr_auto] sm:items-end">
                        <div className="flex flex-col gap-1">
                          <Label className="text-xs">{t.ttStart}</Label>
                          <Input type="time" dir="ltr" value={r.startTime} disabled={!canWrite} onChange={(e) => patchRow(r.key, { startTime: e.target.value })} />
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label className="text-xs">{t.ttEnd}</Label>
                          <Input type="time" dir="ltr" value={r.endTime} disabled={!canWrite} onChange={(e) => patchRow(r.key, { endTime: e.target.value })} />
                        </div>
                        <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                          <Label className="text-xs">{t.ttSubject}</Label>
                          <Select value={subjectValue} disabled={!canWrite} onValueChange={(v) => v === OTHER ? patchRow(r.key, { custom: true, subject: subjectNames.includes(r.subject) || presetNames.includes(r.subject) ? "" : r.subject }) : patchRow(r.key, { custom: false, subject: v })}>
                            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>
                              {subjectNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                              {presetNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                              <SelectItem value={OTHER}>{t.ttOther}</SelectItem>
                            </SelectContent>
                          </Select>
                          {subjectValue === OTHER && (
                            <Input value={r.subject} disabled={!canWrite} onChange={(e) => patchRow(r.key, { custom: true, subject: e.target.value })} placeholder={t.ttCustomSubject} maxLength={60} />
                          )}
                        </div>
                        <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                          <Label className="text-xs">{t.ttTeacher}</Label>
                          <Select value={r.teacherUserId || "none"} disabled={!canWrite} onValueChange={(v) => patchRow(r.key, { teacherUserId: v === "none" ? "" : v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">{t.ttNoTeacher}</SelectItem>
                              {teachers.map((x) => <SelectItem key={x.userId} value={x.userId}>{x.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        {canWrite && (
                          <Button size="icon" variant="ghost" aria-label={t.ttRemove} className="col-span-2 justify-self-end sm:col-span-1" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                      <Input value={r.note} disabled={!canWrite} onChange={(e) => patchRow(r.key, { note: e.target.value })} placeholder={t.ttNote} maxLength={200} className="h-8 text-xs" />
                      {err && <p className="text-xs text-destructive">{err}</p>}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {canWrite && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={addRow} data-testid="tt-add"><Plus className="me-1 size-4" /> {t.ttAddPeriod}</Button>
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground">{t.ttGap}</Label>
                <Select value={gap} onValueChange={setGap}>
                  <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">{t.ttGapNone}</SelectItem>
                    {[5, 10, 15, 20, 30].map((n) => <SelectItem key={n} value={String(n)}>{t.ttGapMinutes.replace("{n}", String(n))}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {canWrite && (
            <div className="sticky bottom-2 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-2 shadow-sm backdrop-blur">
              <Button onClick={save} disabled={saving || !dirty} data-testid="tt-save">
                {saving ? <Loader2 className="me-2 size-4 animate-spin" /> : <Save className="me-2 size-4" />}
                {t.ttSaveDay}
              </Button>
              {dirty && <span className="text-xs text-amber-600">{t.ttDirty}</span>}
              <div className="ms-auto flex gap-2">
                <Button variant="outline" size="sm" disabled={saving || dirty || !(serverDays[day]?.length)} title={dirty ? t.ttCopyNeedsSave : undefined} onClick={() => { setCopyTo([]); setCopyOpen(true); }}>
                  <Copy className="me-1 size-4" /> {t.ttCopyDay}
                </Button>
                <Button variant="outline" size="sm" disabled={saving || (!(serverDays[day]?.length) && !dirty)} onClick={clearDay}>
                  <Eraser className="me-1 size-4" /> {t.ttClearDay}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.ttCopyTitle} ({dayNames[day]})</DialogTitle>
            <DialogDescription>{t.ttCopyHint}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {dayNames.map((name, i) => i === day ? null : (
              <label key={i} className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm">
                <Checkbox checked={copyTo.includes(i)} onCheckedChange={(c) => setCopyTo((x) => c ? [...x, i] : x.filter((d) => d !== i))} />
                {name}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyOpen(false)}>{t.cancelButton}</Button>
            <Button onClick={doCopy} disabled={saving || !copyTo.length}>{saving && <Loader2 className="me-2 size-4 animate-spin" />}{t.ttCopyConfirm}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {legacyVisible.length > 0 && (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">{t.ttLegacyTitle} ({lang === "fa" ? legacyVisible.length.toLocaleString("fa-IR") : legacyVisible.length})</summary>
          <div className="mt-2 flex flex-col gap-2">
            {legacyVisible.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2"><CalendarClock className="size-4 text-muted-foreground" />{p.title}{p.dayOfWeek != null && ` · ${dayNames[Number(p.dayOfWeek)] ?? ""}`}{p.startTime && ` · ${p.startTime}-${p.endTime ?? ""}`}</span>
                {canWrite && (
                  <Button size="icon" variant="ghost" onClick={async () => { await deleteSchoolProgram(schoolId!, p.id); await queryClient.invalidateQueries({ queryKey: ["schools", "programs", schoolId] }); }}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
