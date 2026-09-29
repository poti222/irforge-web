import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileQuestion, Plus, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import {
  getSchoolMe, listSchoolClasses, listSchoolQuestions, listSchoolExams, createSchoolExam,
  listExamAttempts, gradeExamAttempt, resetExamAttempt, listSchoolMembers,
} from "@/lib/schools-api";

/**
 * pages/schools/teacher/exams.tsx — «آزمون‌ها» (فاز ۴، بندِ ۲): معلم برایِ
 * یکی از کلاس‌های خودش، از بانکِ سؤالِ خودش چند سؤال انتخاب می‌کند و آزمون
 * می‌سازد؛ سپس تلاش‌ها/نمره‌ها را می‌بیند. نمره‌ی خودکار (اگر همه‌ی سؤال‌ها
 * چندگزینه‌ای باشند) توسطِ سرور محاسبه می‌شود؛ این‌جا فقط برایِ سؤالِ تشریحی
 * یک اینپوتِ نمره‌ی دستی هست.
 */
export default function TeacherExamsPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navExams);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;

  const { data: myClasses, isLoading } = useQuery({
    queryKey: ["schools", "classes", schoolId, "mine"],
    queryFn: () => listSchoolClasses(schoolId!, true),
    enabled: !!schoolId,
  });
  const { data: myQuestions } = useQuery({
    queryKey: ["schools", "questions", schoolId],
    queryFn: () => listSchoolQuestions(schoolId!),
    enabled: !!schoolId,
  });

  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [durationMinutes, setDurationMinutes] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [openExamId, setOpenExamId] = useState<string | null>(null);

  const { data: exams } = useQuery({
    queryKey: ["schools", "exams", schoolId, selectedClassId],
    queryFn: () => listSchoolExams(schoolId!, selectedClassId),
    enabled: !!schoolId && !!selectedClassId,
  });

  function toggleQuestion(id: string) {
    setSelectedQuestionIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function handleCreate() {
    if (!schoolId || !selectedClassId || !title.trim() || selectedQuestionIds.length === 0) return;
    setSaving(true);
    try {
      await createSchoolExam(schoolId, {
        classId: selectedClassId,
        title: title.trim(),
        questionIds: selectedQuestionIds,
        durationMinutes: durationMinutes ? Number(durationMinutes) : null,
        scheduledAt: scheduledAt || null,
      });
      await queryClient.invalidateQueries({ queryKey: ["schools", "exams", schoolId, selectedClassId] });
      setTitle(""); setSelectedQuestionIds([]); setDurationMinutes(""); setScheduledAt(""); setShowForm(false);
      toast({ title: t.examSaved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.examSaveError, description: err?.data?.error });
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navExams}</h1>
        <p className="text-sm text-muted-foreground">{t.examsPageDescription}</p>
      </div>

      {!myClasses || myClasses.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.classesEmpty}</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {myClasses.map((c) => (
              <Card key={c.id} className={selectedClassId === c.id ? "cursor-pointer border-primary" : "cursor-pointer"} onClick={() => setSelectedClassId(c.id)} role="button">
                <CardHeader className="pb-2"><CardTitle className="text-base">{c.name}</CardTitle></CardHeader>
              </Card>
            ))}
          </div>

          {selectedClassId && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="font-medium">{t.examsListTitle}</h2>
                <Button size="sm" variant={showForm ? "secondary" : "default"} onClick={() => setShowForm((s) => !s)}>
                  <Plus className="me-1 size-4" /> {t.addExamButton}
                </Button>
              </div>

              {showForm && (
                <Card>
                  <CardContent className="flex flex-col gap-3 pt-4">
                    <div className="flex flex-col gap-1.5">
                      <Label>{t.fieldExamTitle}</Label>
                      <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1.5 sm:w-56">
                      <Label>{t.fieldExamDuration}</Label>
                      <Input type="number" min="1" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} dir="ltr" />
                    </div>
                    <div className="flex flex-col gap-1.5 sm:w-72">
                      <Label>{t.fieldExamScheduledAt}</Label>
                      <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} dir="ltr" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>{t.fieldExamQuestions}</Label>
                      {!myQuestions || myQuestions.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t.questionsEmpty}</p>
                      ) : (
                        <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border p-2">
                          {myQuestions.map((q) => (
                            <label key={q.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                              <Checkbox checked={selectedQuestionIds.includes(q.id)} onCheckedChange={() => toggleQuestion(q.id)} />
                              {q.questionText}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button onClick={handleCreate} disabled={saving || !title.trim() || selectedQuestionIds.length === 0} className="w-fit">
                      {saving && <Loader2 className="me-2 size-4 animate-spin" />}
                      {t.saveButton}
                    </Button>
                  </CardContent>
                </Card>
              )}

              {!exams || exams.length === 0 ? (
                <div className="flex h-24 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.examsEmpty}</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {exams.map((e) => (
                    <Card key={e.id}>
                      <CardContent className="flex flex-col gap-2 py-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 font-medium">
                            <FileQuestion className="size-4 text-primary" /> {e.title}
                            <Badge variant="outline">{e.questionIds.length} {t.questionsCountSuffix}</Badge>
                          </div>
                          <Button size="sm" variant="ghost" onClick={() => setOpenExamId(openExamId === e.id ? null : e.id)}>
                            {t.viewAttemptsButton}
                          </Button>
                        </div>
                        {openExamId === e.id && <ExamAttemptsPanel schoolId={schoolId!} examId={e.id} />}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function ExamAttemptsPanel({ schoolId, examId }: { schoolId: string; examId: string }) {
  const t = useT("schools") as any;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: attempts, isLoading } = useQuery({
    queryKey: ["schools", "exam-attempts", examId],
    queryFn: () => listExamAttempts(schoolId, examId),
  });
  const { data: members } = useQuery({ queryKey: ["schools", "members", schoolId], queryFn: () => listSchoolMembers(schoolId) });
  const [scores, setScores] = useState<Record<string, string>>({});

  async function handleGrade(attemptId: string) {
    try {
      await gradeExamAttempt(schoolId, examId, attemptId, scores[attemptId] ?? null);
      await queryClient.invalidateQueries({ queryKey: ["schools", "exam-attempts", examId] });
      toast({ title: t.gradeSaved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.examSaveError, description: err?.data?.error });
    }
  }

  // فازِ ۵ (بندِ ۳): «بازنشانیِ تلاش» — حذفِ ردیفِ تلاشِ فعلی تا دانش‌آموز
  // بتواند دوباره آزمون را شروع کند (ایندکسِ یکتا اجازه‌ی تلاشِ دومِ همزمان
  // را نمی‌دهد، پس اول باید ردیفِ قبلی برود).
  async function handleReset(attemptId: string) {
    if (!confirm(t.resetAttemptConfirm)) return;
    try {
      await resetExamAttempt(schoolId, examId, attemptId);
      await queryClient.invalidateQueries({ queryKey: ["schools", "exam-attempts", examId] });
      toast({ title: t.attemptReset });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.examSaveError, description: err?.data?.error });
    }
  }

  if (isLoading) return <Loader2 className="size-4 animate-spin" />;

  return (
    <div className="mt-2 flex flex-col gap-2 border-t pt-2">
      {!attempts || attempts.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.noAttemptsYet}</p>
      ) : (
        attempts.map((a) => {
          const person = (members ?? []).find((m) => m.id === a.studentMemberId);
          return (
            <div key={a.id} className="flex flex-col gap-1 rounded-md border p-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{person?.userName ?? person?.userEmail ?? a.studentMemberId}</span>
                {a.score && <Badge>{a.score}</Badge>}
              </div>
              <span className="text-xs text-muted-foreground">
                {a.submittedAt ? t.attemptSubmitted : t.attemptInProgress}
              </span>
              <div className="flex items-center gap-2">
                <Input
                  className="h-8 w-24"
                  placeholder={t.fieldGrade}
                  value={scores[a.id] ?? a.score ?? ""}
                  onChange={(e) => setScores((s) => ({ ...s, [a.id]: e.target.value }))}
                />
                <Button size="sm" variant="outline" onClick={() => handleGrade(a.id)}>{t.saveButton}</Button>
                <Button size="sm" variant="ghost" onClick={() => handleReset(a.id)} title={t.resetAttemptButton}>
                  <RotateCcw className="me-1 size-3.5" /> {t.resetAttemptButton}
                </Button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
