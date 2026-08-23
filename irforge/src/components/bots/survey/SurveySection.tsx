/**
 * SurveySection.tsx — IRFORGE_PROMPT_V3 Phase 20
 * ─────────────────────────────────────────────────────────────────────────────
 * List + editor for the `survey` plugin, including real question authoring
 * (choice/rating/text, quiz correct-answer marking) — the generic
 * `PluginCollectionTable` never had a `questions` field at all, so a
 * survey created from the site could never actually be published (the bot
 * refuses with zero questions). Answering a survey stays bot-only; this
 * section only defines surveys and reads results.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import {
  ClipboardList, Loader2, Plus, Trash2, Pencil, BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";

type QuestionType = "choice" | "rating" | "text";
type Question = { id: number; text: string; type: QuestionType; options: string[]; correct?: number };
type Survey = {
  id: string; title: string; description: string; questions: Question[];
  is_quiz: boolean; is_active: boolean; anonymous: boolean; response_count: number;
};
type QuestionSummary = {
  question: string; type: QuestionType; answered: number;
  options?: Array<{ option: string; count: number; percent: number; correct: boolean }>;
  average?: number; samples?: string[];
};

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}

const TYPE_LABEL_KEY: Record<QuestionType, string> = { choice: "typeChoice", rating: "typeRating", text: "typeText" };

function QuestionForm({
  botId, survey, editing, onDone,
}: { botId: string; survey: Survey; editing: Question | null; onDone: () => void }) {
  const t = useT("botSurvey");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState(editing?.text ?? "");
  const [type, setType] = useState<QuestionType>(editing?.type ?? "rating");
  const [optionsText, setOptionsText] = useState((editing?.options ?? []).join("\n"));
  const [correctIndex, setCorrectIndex] = useState<number | null>(editing?.correct ?? null);

  const options = optionsText.split("\n").map((o) => o.trim()).filter(Boolean);

  const save = useMutation({
    mutationFn: () => {
      const body = { text, type, options, correct_index: type === "choice" ? correctIndex : null };
      return editing
        ? customFetch(`/api/bots/${botId}/surveys/${survey.id}/questions/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : customFetch(`/api/bots/${botId}/surveys/${survey.id}/questions`, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bot-surveys", botId] }); onDone(); },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const canSave = text.trim() && (type !== "choice" || options.length >= 2);

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-1">
        <Label>{t.fieldQuestionText}</Label>
        <Input value={text} maxLength={300} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label>{t.fieldQuestionType}</Label>
        <Select value={type} onValueChange={(v) => { setType(v as QuestionType); setCorrectIndex(null); }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="choice">{t.typeChoice}</SelectItem>
            <SelectItem value="rating">{t.typeRating}</SelectItem>
            <SelectItem value="text">{t.typeText}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {type === "choice" && (
        <div className="space-y-1">
          <Label>{t.fieldOptions}</Label>
          <Textarea rows={3} value={optionsText} onChange={(e) => setOptionsText(e.target.value)} placeholder={t.optionsPlaceholder} />
          {survey.is_quiz && options.length >= 2 && (
            <div className="space-y-1 pt-1">
              <Label>{t.fieldCorrectOption}</Label>
              <Select value={correctIndex === null ? "__none__" : String(correctIndex)} onValueChange={(v) => setCorrectIndex(v === "__none__" ? null : Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t.notScored}</SelectItem>
                  {options.map((opt, i) => <SelectItem key={i} value={String(i)}>{opt}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>{t.cancel}</Button>
        <Button size="sm" onClick={() => save.mutate()} disabled={!canSave || save.isPending}>
          {save.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
          {t.save}
        </Button>
      </div>
    </div>
  );
}

function ResultsDialog({ botId, survey, onClose }: { botId: string; survey: Survey; onClose: () => void }) {
  const t = useT("botSurvey");
  const { data, isLoading } = useQuery({
    queryKey: ["bot-survey-results", botId, survey.id],
    queryFn: () => customFetch<{ results: QuestionSummary[] }>(`/api/bots/${botId}/surveys/${survey.id}/results`),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>{t.resultsTitle.replace("{title}", survey.title)}</DialogTitle></DialogHeader>
        {isLoading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>
        ) : (
          <div className="space-y-4">
            {(data?.results ?? []).length === 0 && <p className="text-sm text-muted-foreground">{t.noQuestionsYet}</p>}
            {(data?.results ?? []).map((r, i) => (
              <div key={i} className="space-y-2 rounded-md border p-3">
                <p className="font-medium">{r.question}</p>
                <p className="text-xs text-muted-foreground">{t.answeredCount.replace("{n}", String(r.answered))}</p>
                {r.options && (
                  <div className="space-y-1.5">
                    {r.options.map((opt, oi) => (
                      <div key={oi} className="space-y-0.5">
                        <div className="flex items-center justify-between text-xs">
                          <span>{opt.option} {opt.correct && <Badge variant="outline" className="ms-1">{t.correctBadge}</Badge>}</span>
                          <span dir="ltr">{opt.count} ({opt.percent}%)</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div className="h-full bg-primary" style={{ width: `${opt.percent}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {r.average !== undefined && (
                  <p dir="ltr" className="text-sm">{t.averageLabel}: <strong>{r.average}</strong> / 5</p>
                )}
                {r.samples && (
                  <ul className="list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
                    {r.samples.length === 0 && <li>{t.noSamplesYet}</li>}
                    {r.samples.map((s, si) => <li key={si}>{s}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SurveyEditor({ botId, surveyId, onClose }: { botId: string; surveyId: string; onClose: () => void }) {
  const t = useT("botSurvey");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addingQuestion, setAddingQuestion] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);

  const listKey = ["bot-surveys", botId] as const;
  const { data } = useQuery({
    queryKey: listKey,
    queryFn: () => customFetch<{ surveys: Survey[] }>(`/api/bots/${botId}/surveys`),
  });
  const survey = data?.surveys.find((s) => s.id === surveyId);

  const [title, setTitle] = useState(survey?.title ?? "");
  const [description, setDescription] = useState(survey?.description ?? "");
  const [isQuiz, setIsQuiz] = useState(survey?.is_quiz ?? false);
  const [anonymous, setAnonymous] = useState(survey?.anonymous ?? false);

  const saveMeta = useMutation({
    mutationFn: () => customFetch(`/api/bots/${botId}/surveys/${surveyId}`, {
      method: "PATCH", body: JSON.stringify({ title, description, is_quiz: isQuiz, anonymous }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: listKey }); toast({ title: t.surveyUpdated }); },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const removeQuestion = useMutation({
    mutationFn: (questionId: number) => customFetch(`/api/bots/${botId}/surveys/${surveyId}/questions/${questionId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: listKey }),
  });

  const publish = useMutation({
    mutationFn: (active: boolean) => customFetch(`/api/bots/${botId}/surveys/${surveyId}/publish`, { method: "POST", body: JSON.stringify({ active }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: listKey }),
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  if (!survey) return null;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{t.editSurvey}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>{t.fieldTitle}</Label>
            <Input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== survey.title && saveMeta.mutate()} />
          </div>
          <div className="space-y-1">
            <Label>{t.fieldDescription}</Label>
            <Textarea rows={2} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} onBlur={() => description !== survey.description && saveMeta.mutate()} />
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch checked={isQuiz} onCheckedChange={(v) => { setIsQuiz(v); saveMeta.mutate(); }} />
              <span className="text-sm">{t.fieldIsQuiz}</span>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={anonymous} onCheckedChange={(v) => { setAnonymous(v); saveMeta.mutate(); }} />
              <span className="text-sm">{t.fieldAnonymous}</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t.questionsLabel.replace("{n}", String(survey.questions.length))}</Label>
              {!addingQuestion && (
                <Button size="sm" variant="outline" onClick={() => setAddingQuestion(true)}>
                  <Plus className="me-1.5 size-3.5" /> {t.addQuestion}
                </Button>
              )}
            </div>

            {survey.questions.length === 0 && !addingQuestion && (
              <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">{t.noQuestionsHint}</p>
            )}

            <div className="space-y-2">
              {survey.questions.map((q) =>
                editingQuestion?.id === q.id ? (
                  <QuestionForm key={q.id} botId={botId} survey={survey} editing={q} onDone={() => setEditingQuestion(null)} />
                ) : (
                  <div key={q.id} className="flex items-start justify-between gap-2 rounded-md bg-muted/40 p-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{q.text}</p>
                      <p className="text-xs text-muted-foreground">
                        {t[TYPE_LABEL_KEY[q.type] as keyof typeof t] as string}
                        {q.type === "choice" && ` — ${q.options.join("، ")}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setEditingQuestion(q)}><Pencil className="size-3.5" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => removeQuestion.mutate(q.id)}><Trash2 className="size-3.5 text-destructive" /></Button>
                    </div>
                  </div>
                )
              )}
            </div>

            {addingQuestion && (
              <QuestionForm botId={botId} survey={survey} editing={null} onDone={() => setAddingQuestion(false)} />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant={survey.is_active ? "outline" : "default"}
            onClick={() => publish.mutate(!survey.is_active)}
            disabled={publish.isPending || (!survey.is_active && survey.questions.length === 0)}
          >
            {publish.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {survey.is_active ? t.unpublish : t.publish}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SurveySection({ bot }: { bot: Bot }) {
  const t = useT("botSurvey");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [resultsFor, setResultsFor] = useState<Survey | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const key = ["bot-surveys", bot.id] as const;
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => customFetch<{ surveys: Survey[] }>(`/api/bots/${bot.id}/surveys`),
  });

  const activate = useMutation({
    mutationFn: () => customFetch(`/api/bots/${bot.id}/plugins/survey`, { method: "PATCH", body: JSON.stringify({ enabled: true }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bot-plugins", bot.id] }); qc.invalidateQueries({ queryKey: key }); },
  });

  const create = useMutation({
    mutationFn: () => customFetch<{ survey: Survey }>(`/api/bots/${bot.id}/surveys`, { method: "POST", body: JSON.stringify({ title: newTitle }) }),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: key }); setCreating(false); setNewTitle(""); setEditingId(res.survey.id); },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => customFetch(`/api/bots/${bot.id}/surveys/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast({ title: t.surveyDeleted }); },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  if (isLoading) return <div className="flex items-center gap-2 p-8 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;

  if (errCode(error) === "plugin_disabled") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <ClipboardList className="size-8 text-muted-foreground" />
          <p className="font-semibold">{t.pluginDisabledTitle}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t.pluginDisabledDesc}</p>
          <Button onClick={() => activate.mutate()} disabled={activate.isPending}>
            {activate.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {activate.isPending ? t.activating : t.activatePlugin}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {errCode(error) === "no_sheet" ? t.noSheetYet : errMessage(error, t.errorGeneric)}
      </div>
    );
  }

  const surveys = data?.surveys ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t.sectionDesc}</p>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="me-1.5 size-4" /> {t.newSurvey}
        </Button>
      </div>

      {surveys.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{t.noSurveys}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {surveys.map((s) => (
            <Card key={s.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 font-medium">
                      <span className="truncate">{s.title}</span>
                      {s.is_quiz && <Badge variant="outline">{t.quizBadge}</Badge>}
                      <Badge variant={s.is_active ? "default" : "outline"}>{s.is_active ? t.publishedBadge : t.draftBadge}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.questionCount.replace("{n}", String(s.questions?.length ?? 0))} · {t.responseCount.replace("{n}", String(s.response_count))}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditingId(s.id)}>
                    <Pencil className="me-1.5 size-3.5" /> {t.edit}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setResultsFor(s)}>
                    <BarChart3 className="me-1.5 size-3.5" /> {t.viewResults}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => remove.mutate(s.id)} disabled={remove.isPending}>
                    <Trash2 className="me-1.5 size-3.5" /> {t.delete}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {creating && (
        <Dialog open onOpenChange={(v) => !v && setCreating(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>{t.newSurvey}</DialogTitle></DialogHeader>
            <div className="space-y-1">
              <Label>{t.fieldTitle}</Label>
              <Input value={newTitle} maxLength={100} onChange={(e) => setNewTitle(e.target.value)} />
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={!newTitle.trim() || create.isPending}>
                {create.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
                {t.save}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {editingId && <SurveyEditor botId={bot.id} surveyId={editingId} onClose={() => setEditingId(null)} />}
      {resultsFor && <ResultsDialog botId={bot.id} survey={resultsFor} onClose={() => setResultsFor(null)} />}
    </div>
  );
}
