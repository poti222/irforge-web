import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Loader2, FileQuestion, Plus, RotateCcw, BarChart3 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import {
  getSchoolMe, listSchoolClasses, listSchoolQuestions, listSchoolExams, createSchoolExam,
  listExamAttempts, gradeExamQuestions, resetExamAttempt, listSchoolMembers, listExamQuestions,
  getExamAnalytics, type ExamAttempt,
} from "@/lib/schools-api";

/**
 * pages/schools/teacher/exams.tsx — «آزمون‌ها» (فاز ۴، بندِ ۲؛ بهبودهایِ فازِ
 * ۱۰): معلم برایِ یکی از کلاس‌های خودش، از بانکِ سؤالِ خودش چند سؤال انتخاب
 * می‌کند و آزمون می‌سازد (اختیاراً با ترتیبِ تصادفیِ سؤال‌ها به‌ازایِ هر
 * دانش‌آموز)؛ سپس تلاش‌ها را سؤال‌به‌سؤال نمره می‌دهد و تحلیلِ کلاسی می‌بیند.
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
  const [randomizeOrder, setRandomizeOrder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openExamId, setOpenExamId] = useState<string | null>(null);
  const [analyticsExamId, setAnalyticsExamId] = useState<string | null>(null);

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
        randomizeOrder,
      });
      await queryClient.invalidateQueries({ queryKey: ["schools", "exams", schoolId, selectedClassId] });
      setTitle(""); setSelectedQuestionIds([]); setDurationMinutes(""); setScheduledAt(""); setRandomizeOrder(false); setShowForm(false);
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
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={randomizeOrder} onCheckedChange={(v) => setRandomizeOrder(v === true)} />
                      {t.fieldExamRandomizeOrder}
                    </label>
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
                            {e.randomizeOrder && <Badge variant="secondary">{t.examRandomizedBadge}</Badge>}
                          </div>
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setAnalyticsExamId(analyticsExamId === e.id ? null : e.id)}>
                              <BarChart3 className="me-1 size-4" /> {t.examAnalyticsButton}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setOpenExamId(openExamId === e.id ? null : e.id)}>
                              {t.viewAttemptsButton}
                            </Button>
                          </div>
                        </div>
                        {analyticsExamId === e.id && <ExamAnalyticsPanel schoolId={schoolId!} examId={e.id} />}
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

/** فازِ ۱۰ (بندِ ۲.۴): میانگین/بالاترین/پایین‌ترین + توزیعِ نمره‌ها — همان الگویِ نمودارِ بارِ AdminOverview/academic-status. */
function ExamAnalyticsPanel({ schoolId, examId }: { schoolId: string; examId: string }) {
  const t = useT("schools") as any;
  const { data, isLoading } = useQuery({
    queryKey: ["schools", "exam-analytics", examId],
    queryFn: () => getExamAnalytics(schoolId, examId),
  });

  if (isLoading) return <Loader2 className="size-4 animate-spin" />;
  if (!data || data.gradedCount === 0) {
    return <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">{t.examAnalyticsEmpty}</p>;
  }

  return (
    <div className="mt-2 flex flex-col gap-3 border-t pt-2">
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">{t.examAnalyticsAverage}</div>
          <div className="font-bold" dir="ltr">{data.average}%</div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">{t.examAnalyticsHighest}</div>
          <div className="font-bold" dir="ltr">{data.highest}%</div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">{t.examAnalyticsLowest}</div>
          <div className="font-bold" dir="ltr">{data.lowest}%</div>
        </div>
      </div>
      <div className="h-40 w-full" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.distribution} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
            <XAxis dataKey="range" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
            <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
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
  const { data: questions } = useQuery({
    queryKey: ["schools", "exam-questions", examId, "teacher"],
    queryFn: () => listExamQuestions(schoolId, examId),
  });
  const { data: members } = useQuery({ queryKey: ["schools", "members", schoolId], queryFn: () => listSchoolMembers(schoolId) });
  // فازِ ۱۰ (بندِ ۲.۱): نمره‌ی پیش‌نویسِ هر سؤالِ تشریحی، کلید = `${attemptId}:${questionId}`.
  const [draftPoints, setDraftPoints] = useState<Record<string, string>>({});

  async function handleSaveQuestionGrades(attempt: ExamAttempt) {
    const essayQuestionIds = (questions ?? []).filter((q) => !q.choices).map((q) => q.id);
    const questionPoints: Record<string, number> = {};
    for (const qid of essayQuestionIds) {
      const raw = draftPoints[`${attempt.id}:${qid}`];
      if (raw !== undefined && raw.trim() !== "") questionPoints[qid] = Number(raw);
    }
    if (Object.keys(questionPoints).length === 0) return;
    try {
      await gradeExamQuestions(schoolId, examId, attempt.id, questionPoints);
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

  const byId = new Map((questions ?? []).map((q) => [q.id, q]));

  return (
    <div className="mt-2 flex flex-col gap-2 border-t pt-2">
      {!attempts || attempts.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.noAttemptsYet}</p>
      ) : (
        attempts.map((a) => {
          const person = (members ?? []).find((m) => m.id === a.studentMemberId);
          // فازِ ۱۰ (بندِ ۲.۲): نمایِ معلم همیشه ترتیبِ بانکِ سؤال است، نه questionOrderِ شخصی‌شده‌یِ خودِ دانش‌آموز.
          const orderedBreakdown = (questions ?? []).map((q) => (a.answerBreakdown ?? []).find((b) => b.questionId === q.id));
          return (
            <div key={a.id} className="flex flex-col gap-1 rounded-md border p-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{person?.userName ?? person?.userEmail ?? a.studentMemberId}</span>
                <span className="flex items-center gap-1.5">
                  {a.lateSubmission && <Badge variant="destructive">{t.lateSubmissionBadge}</Badge>}
                  {a.score && <Badge>{a.score}</Badge>}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {a.submittedAt ? t.attemptSubmitted : t.attemptInProgress}
              </span>

              {/* فازِ ۱۰ (بندِ ۲.۱): شکستِ نمره به‌ازایِ هر سؤال — تشریحی‌ها اینپوتِ نمره‌ی خودشان را دارند. */}
              {a.submittedAt && questions && questions.length > 0 && (
                <div className="flex flex-col gap-1 rounded-md bg-muted/30 p-2">
                  {(questions ?? []).map((q, idx) => {
                    const entry = orderedBreakdown[idx];
                    const isEssay = !q.choices;
                    return (
                      <div key={q.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate">{idx + 1}. {q.questionText}</span>
                        {!isEssay ? (
                          <Badge variant={entry?.correct ? "default" : "destructive"} className="shrink-0">
                            {entry?.correct ? t.questionResultCorrect : t.questionResultWrong}
                          </Badge>
                        ) : (
                          <Input
                            type="number"
                            min="0"
                            max="1"
                            step="0.5"
                            className="h-7 w-20 shrink-0 text-xs"
                            placeholder={t.fieldQuestionPoints}
                            value={draftPoints[`${a.id}:${q.id}`] ?? (entry?.pointsAwarded ?? "")}
                            onChange={(e) => setDraftPoints((d) => ({ ...d, [`${a.id}:${q.id}`]: e.target.value }))}
                          />
                        )}
                      </div>
                    );
                  })}
                  {(questions ?? []).some((q) => !q.choices) && (
                    <Button size="sm" variant="outline" className="mt-1 w-fit" onClick={() => handleSaveQuestionGrades(a)}>
                      {t.saveButton}
                    </Button>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2">
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
