import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, CalendarClock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { useViewedSchoolId } from "@/hooks/use-viewed-school";
import { getSchoolMe, listSchoolClasses, listSchoolPrograms, createSchoolProgram, deleteSchoolProgram } from "@/lib/schools-api";

const DAYS_FA = ["شنبه", "یک‌شنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه"];

/**
 * pages/schools/admin/programs.tsx — «مدیریتِ برنامه‌ها» (فاز ۲): یک ردیفِ
 * سادۀ «برنامه»، نه موتورِ کاملِ تایم‌تیبل.
 */
export default function SchoolProgramsPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navProgramManagement);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = useViewedSchoolId(me?.schoolId);
  // فاز ۳ (بندِ ۵): معاون/معاون‌انضباطی هم دسترسیِ نوشتن گرفتند (بک‌اند در
  // schoolPrograms.ts هم همین را اعمال می‌کند).
  const canWrite = me?.role === "admin" || me?.role === "deputy" || me?.role === "deputy_discipline";

  const { data: programs, isLoading } = useQuery({
    queryKey: ["schools", "programs", schoolId],
    queryFn: () => listSchoolPrograms(schoolId!),
    enabled: !!schoolId,
  });
  const { data: classes } = useQuery({
    queryKey: ["schools", "classes", schoolId],
    queryFn: () => listSchoolClasses(schoolId!),
    enabled: !!schoolId,
  });

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [classId, setClassId] = useState<string>("none");
  const [dayOfWeek, setDayOfWeek] = useState<string>("none");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!schoolId || !title.trim()) return;
    setSaving(true);
    try {
      await createSchoolProgram(schoolId, {
        title: title.trim(),
        description: description.trim() || null,
        classId: classId === "none" ? null : classId,
        dayOfWeek: dayOfWeek === "none" ? null : dayOfWeek,
        startTime: startTime || null,
        endTime: endTime || null,
      });
      await queryClient.invalidateQueries({ queryKey: ["schools", "programs", schoolId] });
      setTitle(""); setDescription(""); setClassId("none"); setDayOfWeek("none"); setStartTime(""); setEndTime(""); setShowForm(false);
      toast({ title: t.programSaved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.programSaveError, description: err?.data?.error });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(programId: string) {
    if (!schoolId) return;
    try {
      await deleteSchoolProgram(schoolId, programId);
      await queryClient.invalidateQueries({ queryKey: ["schools", "programs", schoolId] });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.programSaveError, description: err?.data?.error });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{t.navProgramManagement}</h1>
          <p className="text-sm text-muted-foreground">{t.programsPageDescription}</p>
        </div>
        {canWrite && (
          <Button size="sm" variant={showForm ? "secondary" : "default"} onClick={() => setShowForm((s) => !s)}>
            <Plus className="me-1 size-4" /> {t.addProgramButton}
          </Button>
        )}
      </div>

      {canWrite && showForm && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            <div className="flex flex-col gap-1.5">
              <Label>{t.fieldProgramTitle}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t.fieldProgramDescription}</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label>{t.fieldProgramClass}</Label>
                <Select value={classId} onValueChange={setClassId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t.programWholeSchool}</SelectItem>
                    {(classes ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t.fieldProgramDay}</Label>
                <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {DAYS_FA.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t.fieldProgramStart}</Label>
                <Input value={startTime} onChange={(e) => setStartTime(e.target.value)} placeholder="08:00" dir="ltr" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t.fieldProgramEnd}</Label>
                <Input value={endTime} onChange={(e) => setEndTime(e.target.value)} placeholder="09:30" dir="ltr" />
              </div>
            </div>
            <Button onClick={handleCreate} disabled={saving || !title.trim()} className="w-fit">
              {saving && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.saveButton}
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <Loader2 className="size-6 animate-spin" />
      ) : !programs || programs.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.programsEmpty}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {programs.map((p) => (
            <Card key={p.id}>
              <CardContent className="flex items-center justify-between gap-2 py-3">
                <div className="flex items-start gap-2">
                  <CalendarClock className="mt-0.5 size-4 text-muted-foreground" />
                  <div>
                    <div className="font-medium">{p.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {(classes ?? []).find((c) => c.id === p.classId)?.name ?? t.programWholeSchool}
                      {p.dayOfWeek != null && ` · ${DAYS_FA[Number(p.dayOfWeek)] ?? p.dayOfWeek}`}
                      {p.startTime && ` · ${p.startTime}-${p.endTime ?? ""}`}
                    </div>
                    {p.description && <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>}
                  </div>
                </div>
                {canWrite && (
                  <Button size="icon" variant="ghost" onClick={() => handleDelete(p.id)}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
