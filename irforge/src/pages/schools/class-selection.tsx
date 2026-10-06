import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { CheckCircle2, Loader2, LayoutGrid, School as SchoolIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { getSchoolMe, getEnrollmentStatus, selectStudentClass, saveTeacherAssignments, type EnrollmentStatus } from "@/lib/schools-api";

/** عددهایِ فارسی/عربی → لاتین و حذفِ فاصله، تا «پایه‌یِ ۱۱» با «11» یکی شمرده شود. */
function normGrade(g: string | null | undefined): string {
  return (g ?? "").replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\s+/g, "").toLowerCase();
}

/**
 * `/schools/class-selection` — انتخابِ کلاس هنگامِ ورود به مدرسه.
 * دانش‌آموز: دقیقاً یک کلاس (بعدش فقط مدیر عوضش می‌کند). معلم: چند کلاس و برایِ هر کلاس چند درس؛ بعداً هم از
 * همین صفحه («ویرایش کلاس‌ها و درس‌هایِ من») قابلِ‌تغییر است. این صفحه داخلِ SchoolShell است، پس پروفایل/خروج همیشه در دسترس‌اند.
 */
export default function ClassSelectionPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.classSelectionTitle);
  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;
  const { data: status, isLoading, isError, refetch } = useQuery({
    queryKey: ["schools", "enrollment", schoolId],
    queryFn: () => getEnrollmentStatus(schoolId!),
    enabled: !!schoolId,
  });

  if (!schoolId || isLoading) return <div className="flex h-40 items-center justify-center"><Spinner size="lg" /></div>;
  if (isError || !status) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-sm text-destructive" role="alert">
        {t.classSelectionLoadError}
        <Button size="sm" variant="outline" onClick={() => void refetch()}>{t.subjectsRetry}</Button>
      </div>
    );
  }
  if (status.role !== "student" && status.role !== "teacher") {
    return <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t.classSelectionNotApplicable}</div>;
  }
  return status.role === "student"
    ? <StudentPicker schoolId={schoolId} status={status} />
    : <TeacherPicker schoolId={schoolId} status={status} />;
}

function EmptyClasses({ home }: { home: string }) {
  const t = useT("schools") as any;
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center" data-testid="class-selection-empty">
      <SchoolIcon className="size-8 text-muted-foreground" />
      <p className="font-medium">{t.classSelectionEmptyTitle}</p>
      <p className="max-w-md text-sm text-muted-foreground">{t.classSelectionEmptyBody}</p>
      <Button asChild><Link href={home}>{t.classSelectionContinue}</Link></Button>
    </div>
  );
}

function StudentPicker({ schoolId, status }: { schoolId: string; status: EnrollmentStatus }) {
  const t = useT("schools") as any;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [picked, setPicked] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);

  const mine = status.classes.find((c) => c.id === status.studentClassId);
  const wantedGrade = normGrade(status.grade);
  const matching = useMemo(() => status.classes.filter((c) => wantedGrade && normGrade(c.grade) === wantedGrade), [status.classes, wantedGrade]);
  // کلاس‌هایِ هم‌پایه اول؛ اگر هیچ‌کدام نبود (یا کاربر خواست) همه نمایش داده می‌شود.
  const visible = showAll || matching.length === 0 ? status.classes : matching;

  if (mine) {
    return (
      <div className="flex max-w-xl flex-col gap-4">
        <h1 className="text-xl font-bold">{t.classSelectionTitle}</h1>
        <Card><CardContent className="flex items-center gap-3 p-4">
          <CheckCircle2 className="size-5 text-primary" />
          <div>
            <p className="font-medium" data-testid="my-class-name">{mine.name}</p>
            <p className="text-xs text-muted-foreground">{t.classSelectionLockedHint}</p>
          </div>
        </CardContent></Card>
        <Button asChild className="w-fit"><Link href="/schools/student">{t.classSelectionContinue}</Link></Button>
      </div>
    );
  }
  if (status.classes.length === 0) return <EmptyClasses home="/schools/student" />;

  async function save() {
    if (!picked) return;
    setSaving(true);
    try {
      await selectStudentClass(schoolId, picked);
      await queryClient.invalidateQueries({ queryKey: ["schools"] });
      toast({ title: t.classSelectionSaved });
      navigate("/schools/student");
    } catch (err: any) {
      toast({ variant: "destructive", title: t.classSelectionSaveError, description: err?.data?.error });
      await queryClient.invalidateQueries({ queryKey: ["schools", "enrollment", schoolId] });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.classSelectionStudentHeading}</h1>
        <p className="text-sm text-muted-foreground">{t.classSelectionStudentHint}</p>
      </div>
      <div role="radiogroup" aria-label={t.classSelectionTitle} className="grid gap-3 sm:grid-cols-2">
        {visible.map((c) => {
          const on = picked === c.id;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setPicked(c.id)}
              className={`flex min-h-16 flex-col items-start gap-1 rounded-xl border p-4 text-start transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${on ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/50"}`}
              data-testid={`pick-class-${c.id}`}
            >
              <span className="flex items-center gap-2 font-semibold"><LayoutGrid className="size-4" /> {c.name}</span>
              <span className="text-xs text-muted-foreground">{c.grade ?? "—"}{c.academicYear ? ` · ${c.academicYear}` : ""}</span>
            </button>
          );
        })}
      </div>
      {matching.length > 0 && matching.length < status.classes.length && (
        <Button variant="link" className="w-fit px-0" onClick={() => setShowAll((s) => !s)}>
          {showAll ? t.classSelectionShowMatching : t.classSelectionShowAll}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">{t.classSelectionOnceWarning}</p>
      <Button className="min-h-11 w-fit" disabled={!picked || saving} onClick={save} data-testid="button-save-class">
        {saving && <Loader2 className="me-2 size-4 animate-spin" />}
        {t.classSelectionConfirm}
      </Button>
    </div>
  );
}

function TeacherPicker({ schoolId, status }: { schoolId: string; status: EnrollmentStatus }) {
  const t = useT("schools") as any;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [sel, setSel] = useState<Record<string, Set<string>>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const init: Record<string, Set<string>> = {};
    for (const a of status.teacherAssignments) (init[a.classId] ??= new Set()).add(a.subject);
    // کلاسی که معلم در آن هست ولی هنوز درسی ندارد هم باز نمایش داده می‌شود.
    for (const id of status.teacherClassIds) init[id] ??= new Set();
    setSel(init);
  }, [status]);

  if (status.classes.length === 0) return <EmptyClasses home="/schools/teacher" />;

  const toggleClass = (id: string, on: boolean) => setSel((p) => {
    const n = { ...p };
    if (on) n[id] = n[id] ?? new Set(); else delete n[id];
    return n;
  });
  const toggleSubject = (id: string, s: string, on: boolean) => setSel((p) => {
    const set = new Set(p[id] ?? []);
    if (on) set.add(s); else set.delete(s);
    return { ...p, [id]: set };
  });
  const picked = Object.entries(sel);
  const valid = picked.length > 0 && picked.every(([, s]) => s.size > 0);
  const combos = picked.reduce((n, [, s]) => n + s.size, 0);

  async function save() {
    setSaving(true);
    try {
      await saveTeacherAssignments(schoolId, picked.map(([classId, s]) => ({ classId, subjects: [...s] })));
      await queryClient.invalidateQueries({ queryKey: ["schools"] });
      toast({ title: t.classSelectionSaved });
      navigate("/schools/teacher/classes");
    } catch (err: any) {
      toast({ variant: "destructive", title: t.classSelectionSaveError, description: err?.data?.error });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.classSelectionTeacherHeading}</h1>
        <p className="text-sm text-muted-foreground">{t.classSelectionTeacherHint}</p>
      </div>
      <div className="flex flex-col gap-3">
        {status.classes.map((c) => {
          const on = !!sel[c.id];
          return (
            <Card key={c.id} className={on ? "border-primary" : ""}>
              <CardContent className="flex flex-col gap-3 p-4">
                <label className="flex cursor-pointer items-center gap-3">
                  <Checkbox checked={on} onCheckedChange={(v) => toggleClass(c.id, v === true)} data-testid={`teach-class-${c.id}`} />
                  <span className="font-semibold">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.grade ?? "—"}{c.academicYear ? ` · ${c.academicYear}` : ""}</span>
                </label>
                {on && (
                  <div className="grid gap-2 ps-7 sm:grid-cols-2 lg:grid-cols-3">
                    {status.subjects.map((s) => (
                      <label key={s} className="flex cursor-pointer items-center gap-2 text-sm">
                        <Checkbox checked={sel[c.id]?.has(s) ?? false} onCheckedChange={(v) => toggleSubject(c.id, s, v === true)} data-testid={`teach-${c.id}-${s}`} />
                        {s}
                      </label>
                    ))}
                    {sel[c.id]?.size === 0 && <p className="col-span-full text-xs text-destructive">{t.classSelectionPickSubject}</p>}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{t.classSelectionTeacherSummary.replace("{classes}", String(picked.length)).replace("{combos}", String(combos))}</p>
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" disabled={!valid || saving} onClick={save} data-testid="button-save-teacher-classes">
          {saving && <Loader2 className="me-2 size-4 animate-spin" />}
          {t.classSelectionConfirmTeacher}
        </Button>
        {!status.needsSelection && (
          <Button asChild variant="outline" className="min-h-11"><Link href="/schools/teacher/classes">{t.cancel}</Link></Button>
        )}
      </div>
    </div>
  );
}
