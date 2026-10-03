import { useState, useEffect, useRef } from "react";
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
  // فازِ ۱۰ (بندِ ۳): همیشه آخرینِ answersِ تایپ‌شده را نگه می‌دارد تا
  // auto-submitِ تایمر (که داخلِ یک effectِ دیگر صدا زده می‌شود) هیچ‌وقت یک
  // بستنِ قدیمی/خالیِ answers را نفرستد.
  const answersRef = useRef(answers);
  answersRef.current = answers;
  // جلویِ auto-submitِ دوباره را می‌گیرد (مثلاً اگر تیک‌هایِ پشتِ‌هم هر دو صفر برسند).
  const autoSubmittedRef = useRef(false);

  const alreadySubmitted = !!myAttempt?.submittedAt;
  const { data: questions } = useQuery({
    queryKey: ["schools", "exam-questions", exam.id],
    queryFn: () => listExamQuestions(schoolId, exam.id),
    enabled: taking || alreadySubmitted,
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

  async function submitWith(finalAnswers: Record<string, string>) {
    setSubmitting(true);
    try {
      await submitExamAttempt(schoolId, exam.id, finalAnswers);
      await queryClient.invalidateQueries({ queryKey: ["schools", "my-exam-attempt", exam.id] });
      setTaking(false);
      toast({ title: t.examSubmitted });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.examSaveError, description: err?.data?.error });
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit() {
    return submitWith(answersRef.current);
  }

  // فازِ ۶ (بندِ ۳) + فازِ ۱۰ (بندِ ۳): شمارشِ معکوسِ سمتِ کلاینت دیگر فقط
  // نمایشی نیست — رسیدن به صفر همین‌جا با همین پاسخ‌هایِ تاکنون‌پرشده ارسال
  // می‌کند، به‌جایِ این‌که فقط منتظرِ کلیکِ دستیِ دانش‌آموز بماند (که ممکن است
  // دیگر پشتِ صفحه نباشد). محاسبه‌ی authoritative همچنان سمتِ سرور است
  // (lateSubmission بر مبنایِ startedAt، نه ساعتِ کلاینت) — این فقط UX است؛
  // اگر تب بسته شود یا این effect هرگز اجرا نشود، سرور هنوز همان ارسالِ
  // دیرهنگام را قبول/علامت‌گذاری می‌کند.
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (!taking || !myAttempt || !exam.durationMinutes) {
      setRemainingSeconds(null);
      return;
    }
    const deadline = new Date(myAttempt.startedAt).getTime() + exam.durationMinutes * 60000;
    const tick = () => {
      const left = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
      setRemainingSeconds(left);
      if (left === 0 && !autoSubmittedRef.current) {
        autoSubmittedRef.current = true;
        submitWith(answersRef.current);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taking, myAttempt, exam.durationMinutes]);

  if (attemptLoading) return <Loader2 className="size-4 animate-spin" />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2"><FileQuestion className="size-4" /> {exam.title}</span>
          <span className="flex items-center gap-2">
            {myAttempt?.lateSubmission && <Badge variant="destructive">{t.lateSubmissionBadge}</Badge>}
            {myAttempt?.score && <Badge>{myAttempt.score}</Badge>}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {alreadySubmitted ? (
          <>
            <p className="text-sm text-muted-foreground">{t.examAlreadySubmitted}</p>
            {/* فازِ ۱۰ (بندِ ۲.۱): «۳ از ۵» دیگر کافی نیست — این‌جا دقیقاً نشان
                می‌دهد کدام سؤال درست/غلط بود (خودکار) یا هنوز منتظرِ نمره‌دهیِ
                معلم است (تشریحی). */}
            {questions && questions.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {questions.map((q, idx) => {
                  const entry = (myAttempt?.answerBreakdown ?? []).find((b) => b.questionId === q.id);
                  const isEssay = !q.choices;
                  return (
                    <div key={q.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                      <span className="truncate">{idx + 1}. {q.questionText}</span>
                      {isEssay ? (
                        entry?.pointsAwarded === null || entry?.pointsAwarded === undefined ? (
                          <Badge variant="outline" className="shrink-0">{t.questionResultPending}</Badge>
                        ) : (
                          <Badge className="shrink-0" dir="ltr">{entry.pointsAwarded}</Badge>
                        )
                      ) : (
                        <Badge variant={entry?.correct ? "default" : "destructive"} className="shrink-0">
                          {entry?.correct ? t.questionResultCorrect : t.questionResultWrong}
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : taking ? (
          <>
            {remainingSeconds !== null && (
              <p className="text-sm font-medium" dir="ltr">
                {t.examTimeRemaining}: {String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:{String(remainingSeconds % 60).padStart(2, "0")}
              </p>
            )}
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

