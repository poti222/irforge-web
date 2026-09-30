import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Library, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { getSchoolMe, listSchoolQuestions, createSchoolQuestion, deleteSchoolQuestion } from "@/lib/schools-api";

/**
 * pages/schools/teacher/questions.tsx — «بانکِ سؤال» (فاز ۴، بندِ ۲): هر
 * معلم فقط بانکِ سؤالِ خودش را می‌بیند/می‌سازد (ببینید routes/schoolQuestions.ts).
 * چندگزینه‌ای: هر خط از textareaِ گزینه‌ها یک گزینه است؛ correctAnswer اندیسِ
 * همان خط (به‌صورتِ رشته) است. اگر گزینه‌ای وارد نشود، سؤال تشریحی می‌شود
 * (نمره‌اش همیشه دستی‌ست — ببینید submit در schoolExams.ts).
 */
export default function TeacherQuestionsPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navQuestionBank);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;

  const { data: questions, isLoading } = useQuery({
    queryKey: ["schools", "questions", schoolId],
    queryFn: () => listSchoolQuestions(schoolId!),
    enabled: !!schoolId,
  });

  const [questionText, setQuestionText] = useState("");
  const [choicesText, setChoicesText] = useState("");
  const [correctIndex, setCorrectIndex] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const choices = choicesText.split("\n").map((c) => c.trim()).filter(Boolean);

  async function handleCreate() {
    if (!schoolId || !questionText.trim()) return;
    setSaving(true);
    try {
      await createSchoolQuestion(schoolId, {
        questionText: questionText.trim(),
        choices: choices.length > 0 ? choices : null,
        correctAnswer: choices.length > 0 && correctIndex !== "" ? correctIndex : null,
      });
      await queryClient.invalidateQueries({ queryKey: ["schools", "questions", schoolId] });
      setQuestionText(""); setChoicesText(""); setCorrectIndex("");
      toast({ title: t.questionSaved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.questionSaveError, description: err?.data?.error });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!schoolId) return;
    try {
      await deleteSchoolQuestion(schoolId, id);
      await queryClient.invalidateQueries({ queryKey: ["schools", "questions", schoolId] });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.questionSaveError, description: err?.data?.error });
    }
  }

  if (isLoading) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navQuestionBank}</h1>
        <p className="text-sm text-muted-foreground">{t.questionsPageDescription}</p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t.addQuestionButton}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t.fieldQuestionText}</Label>
            <Textarea value={questionText} onChange={(e) => setQuestionText(e.target.value)} rows={2} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t.fieldQuestionChoices}</Label>
            <Textarea value={choicesText} onChange={(e) => setChoicesText(e.target.value)} rows={3} placeholder={t.fieldQuestionChoicesPlaceholder} />
          </div>
          {choices.length > 0 && (
            <div className="flex flex-col gap-1.5 sm:w-56">
              <Label>{t.fieldCorrectAnswer}</Label>
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={correctIndex}
                onChange={(e) => setCorrectIndex(e.target.value)}
              >
                <option value="">—</option>
                {choices.map((c, i) => <option key={i} value={String(i)}>{c}</option>)}
              </select>
            </div>
          )}
          <Button onClick={handleCreate} disabled={saving || !questionText.trim()} className="w-fit">
            {saving ? <Loader2 className="me-2 size-4 animate-spin" /> : <Plus className="me-2 size-4" />}
            {t.addQuestionButton}
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 font-medium"><Library className="size-4" /> {t.questionsListTitle}</h2>
        {!questions || questions.length === 0 ? (
          <div className="flex h-24 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.questionsEmpty}</div>
        ) : (
          questions.map((q) => (
            <Card key={q.id}>
              <CardContent className="flex flex-col gap-2 py-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm">{q.questionText}</p>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(q.id)}><Trash2 className="size-4 text-destructive" /></Button>
                </div>
                {q.choices && q.choices.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {q.choices.map((c, i) => (
                      <Badge key={i} variant={String(i) === q.correctAnswer ? "default" : "outline"}>{c}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
