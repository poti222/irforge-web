import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Loader2, FileQuestion, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import {
  getSchoolMe, listSchoolClasses, listSchoolExams, getMyExamAttempt, startExamAttempt,
  listExamQuestions, submitExamAttempt, type SchoolExam,
} from "@/lib/schools-api";

/**
 * pages/schools/student/exams.tsx — «آزمون‌های من» (فاز ۴، بندِ ۲): آزمون‌هایِ
 * همه‌یِ کلاس‌هایی که دانش‌آموز در آن‌هاست + گرفتنِ آزمون (تک‌صفحه‌ای، بدونِ
 * تایمر/رندومایز — طبقِ اسکوپِ عمداً سادۀ فازِ ۴) + دیدنِ نمره.
 * تصمیم: هر دانش‌آموز فقط یک تلاش دارد؛ بعد از ارسال، فرم دیگر باز نمی‌شود.
 */
export default function StudentExamsPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navExams);

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;

  const { data: classes, isLoading } = useQuery({
    queryKey: ["schools", "classes", schoolId, "mine"],
    queryFn: () => listSchoolClasses(schoolId!, true),
    enabled: !!schoolId,
  });

  if (isLoading) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navExams}</h1>
        <p className="text-sm text-muted-foreground">{t.studentExamsDescription}</p>
      </div>
      {!classes || classes.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.classesEmpty}</div>
      ) : (
        <div className="flex flex-col gap-4">
          {classes.map((c) => (
            <ClassExams key={c.id} schoolId={schoolId!} classId={c.id} className={c.name} />
          ))}
        </div>
      )}
    </div>
  );
}

function ClassExams({ schoolId, classId, className }: { schoolId: string; classId: string; className: string }) {
  const { data: exams } = useQuery({
    queryKey: ["schools", "exams", schoolId, classId],
    queryFn: () => listSchoolExams(schoolId, classId),
  });

  if (!exams || exams.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">{className}</h2>
      {exams.map((e) => (
        <ExamCard key={e.id} schoolId={schoolId} exam={e} />
      ))}
    </div>
  );
}

function ExamCard({ schoolId, exam }: { schoolId: string; exam: SchoolExam }) {
  const t = useT("schools") as any;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: myAttempt, isLoading: attemptLoading } = useQuery({
    queryKey: ["schools", "my-exam-attempt", exam.id],
    queryFn: () => getMyExamAttempt(schoolId, exam.id),
  });

  const [taking, setTaking] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { data: questions } = useQuery({
    queryKey: ["schools", "exam-questions", exam.id],
    queryFn: () => listExamQuestions(schoolId, exam.id),
    enabled: taking,
  });

  async function handleStart() {
    setStarting(true);
    try {
      await startExamAttempt(schoolId, exam.id);
      await queryClient.invalidateQueries({ queryKey: ["schools", "my-exam-attempt", exam.id] });
      setTaking(true);
    } catch (err: any) {
      toast({ variant: "destructive", title: t.examSaveError, description: err?.data?.error });
    } finally {
      setStarting(false);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await submitExamAttempt(schoolId, exam.id, answers);
      await queryClient.invalidateQueries({ queryKey: ["schools", "my-exam-attempt", exam.id] });
      setTaking(false);
      toast({ title: t.examSubmitted });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.examSaveError, description: err?.data?.error });
    } finally {
      setSubmitting(false);
    }
  }

  if (attemptLoading) return <Loader2 className="size-4 animate-spin" />;

  const alreadySubmitted = !!myAttempt?.submittedAt;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2"><FileQuestion className="size-4" /> {exam.title}</span>
          {myAttempt?.score && <Badge>{myAttempt.score}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {alreadySubmitted ? (
          <p className="text-sm text-muted-foreground">{t.examAlreadySubmitted}</p>
        ) : taking ? (
          <>
            {!questions ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <div className="flex flex-col gap-4">
                {questions.map((q, idx) => (
                  <div key={q.id} className="flex flex-col gap-1.5">
                    <Label>{idx + 1}. {q.questionText}</Label>
                    {q.choices && q.choices.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {q.choices.map((c, i) => (
                          <label key={i} className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name={`q-${q.id}`}
                              checked={answers[q.id] === String(i)}
                              onChange={() => setAnswers((a) => ({ ...a, [q.id]: String(i) }))}
                            />
                            {c}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <Textarea rows={2} value={answers[q.id] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />
                    )}
                  </div>
                ))}
                <Button onClick={handleSubmit} disabled={submitting} className="w-fit">
                  {submitting ? <Loader2 className="me-2 size-4 animate-spin" /> : <Send className="me-2 size-4" />}
                  {t.submitExamButton}
                </Button>
              </div>
            )}
          </>
        ) : (
          <Button size="sm" onClick={handleStart} disabled={starting} className="w-fit">
            {starting && <Loader2 className="me-2 size-4 animate-spin" />}
            {t.startExamButton}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

