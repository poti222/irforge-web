/**
 * guidedFlow/GuidedFlowSection.tsx — IRFORGE_GUIDED_FLOW_INVITE_CARD_PROMPT
 * فازِ B1: «سازنده‌ی Guided Flow» — بخشِ تازه‌یِ ادمین.
 *
 * تصمیمِ معماری (مستندشده در PROGRESS.md): یک UIِ لیستی-تودرتو، نه یک
 * بومِ گرافیکیِ drag-and-drop — پرامپت خودش این را به‌عنوانِ گزینه‌ی معتبر
 * برای «وقتی زمان محدود است» صریح اجازه داده («اولویت با کارکردنِ درست
 * است، نه زیبایی‌شناسیِ اولیه»). گام‌ها یک لیستِ تخت‌اند (نه یک درختِ
 * تودرتویِ واقعی)؛ مسیرِ واقعیِ گفت‌وگو کاملاً با transitionها + start_step_id
 * تعیین می‌شود، نه با ترتیبِ نمایشِ گام‌ها.
 */
import { useState } from "react";
import type { Bot } from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, MessageSquare, Sparkles, Plus, Trash2, Pencil, GitBranch } from "lucide-react";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";
import { StepEditorDialog } from "./StepEditorDialog";
import { TransitionEditorDialog } from "./TransitionEditorDialog";
import {
  apiErrorCode, apiErrorMessage, useCreateGuidedFlow, useDeleteGuidedFlow, useDeleteGuidedFlowStep,
  useDeleteGuidedFlowTransition, useGuidedFlowStats, useGuidedFlowSteps, useGuidedFlowTransitions,
  useGuidedFlows, useUpdateGuidedFlow,
  type GuidedFlow, type GuidedFlowStep, type GuidedFlowTransition,
} from "./api";

export function GuidedFlowSection({ bot }: { bot: Bot }) {
  const t = useT("guidedFlow");
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading, error } = useGuidedFlows(bot.id);
  const createFlow = useCreateGuidedFlow(bot.id);
  const deleteFlow = useDeleteGuidedFlow(bot.id);

  // پلاگین «گفت‌وگویِ راهنما» ممکن است روی این بات خاموش باشد — همان
  // قراردادِ showWhenDisabled که survey/booking/drip هم رعایت می‌کنند:
  // سکشن ناپدید نمی‌شود، فقط یک CTAِ فعال‌سازی نشان می‌دهد.
  const activatePlugin = useMutation({
    mutationFn: () =>
      customFetch(`/api/bots/${bot.id}/plugins/guided_flow`, {
        method: "PATCH", body: JSON.stringify({ enabled: true }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-plugins", bot.id] });
      qc.invalidateQueries({ queryKey: ["guided-flows", bot.id] });
    },
  });

  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [flowPendingDelete, setFlowPendingDelete] = useState<GuidedFlow | null>(null);

  const flows = data?.flows ?? [];
  const selectedFlow = flows.find((f) => f.id === selectedFlowId) ?? null;

  async function handleCreateFlow() {
    const title = newTitle.trim();
    if (!title) return;
    try {
      const { flow } = await createFlow.mutateAsync(title);
      setNewTitle("");
      setSelectedFlowId(flow.id);
    } catch (err) {
      toast({ variant: "destructive", description: apiErrorMessage(err, t.saveFailed) });
    }
  }

  async function handleDeleteFlow() {
    if (!flowPendingDelete) return;
    try {
      await deleteFlow.mutateAsync(flowPendingDelete.id);
      if (selectedFlowId === flowPendingDelete.id) setSelectedFlowId(null);
      setFlowPendingDelete(null);
    } catch (err) {
      toast({ variant: "destructive", description: apiErrorMessage(err, t.deleteFailed) });
    }
  }

  if (apiErrorCode(error) === "plugin_disabled") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <GitBranch className="size-8 text-muted-foreground" />
          <p className="font-semibold">{t.pluginDisabledTitle}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t.pluginDisabledDesc}</p>
          <Button onClick={() => activatePlugin.mutate()} disabled={activatePlugin.isPending}>
            {activatePlugin.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {activatePlugin.isPending ? t.activating : t.activatePlugin}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{t.title}</h2>
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t.flowsListTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder={t.newFlowTitlePlaceholder} value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateFlow()}
            />
            <Button onClick={handleCreateFlow} disabled={createFlow.isPending || !newTitle.trim()}>
              {createFlow.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {t.newFlow}
            </Button>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t.loading}</p>
          ) : flows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noFlows}</p>
          ) : (
            <div className="grid gap-2">
              {flows.map((flow) => (
                <button
                  key={flow.id}
                  onClick={() => setSelectedFlowId(flow.id)}
                  className={`flex items-center justify-between rounded-md border p-2.5 text-start transition-colors hover:border-primary/50 ${
                    selectedFlowId === flow.id ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span className="truncate font-medium">{flow.title}</span>
                    <Badge variant={flow.is_active ? "default" : "secondary"} className="shrink-0">
                      {flow.is_active ? t.active : t.inactive}
                    </Badge>
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    className="ms-2 shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); setFlowPendingDelete(flow); }}
                  >
                    <Trash2 className="size-4" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedFlow && <FlowDetail botId={bot.id} flow={selectedFlow} />}

      <AlertDialog open={!!flowPendingDelete} onOpenChange={(v) => !v && setFlowPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deleteFlowConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.deleteFlowConfirmDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteFlow} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FlowDetail({ botId, flow }: { botId: string; flow: GuidedFlow }) {
  const t = useT("guidedFlow");
  const { toast } = useToast();
  const { data: stepsData, isLoading } = useGuidedFlowSteps(botId, flow.id);
  const { data: statsData } = useGuidedFlowStats(botId, flow.id);
  const updateFlow = useUpdateGuidedFlow(botId);
  const deleteStep = useDeleteGuidedFlowStep(botId, flow.id);

  const [editingStep, setEditingStep] = useState<GuidedFlowStep | null | "new">(null);
  const [stepPendingDelete, setStepPendingDelete] = useState<GuidedFlowStep | null>(null);

  const steps = stepsData?.steps ?? [];
  const stats = statsData?.stats;

  async function handleSetStartStep(stepId: string) {
    try {
      await updateFlow.mutateAsync({ flowId: flow.id, patch: { start_step_id: stepId } });
    } catch (err) {
      toast({ variant: "destructive", description: apiErrorMessage(err, t.saveFailed) });
    }
  }

  async function handleToggleActive(active: boolean) {
    try {
      await updateFlow.mutateAsync({ flowId: flow.id, patch: { is_active: active } });
    } catch (err) {
      toast({ variant: "destructive", description: apiErrorMessage(err, t.activateFailed) });
    }
  }

  async function handleDeleteStep() {
    if (!stepPendingDelete) return;
    try {
      await deleteStep.mutateAsync(stepPendingDelete.id);
      setStepPendingDelete(null);
    } catch (err) {
      toast({ variant: "destructive", description: apiErrorMessage(err, t.deleteFailed) });
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-base">{flow.title}</CardTitle>
          {stats && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t.statsLine.replace("{sessions}", String(stats.sessions)).replace("{completed}", String(stats.completed))}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`active-${flow.id}`} className="text-sm text-muted-foreground">{t.activeToggleLabel}</Label>
          <Switch id={`active-${flow.id}`} checked={flow.is_active} onCheckedChange={handleToggleActive} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label>{t.startStepLabel}</Label>
          <Select value={flow.start_step_id || undefined} onValueChange={handleSetStartStep}>
            <SelectTrigger className="w-full sm:w-72"><SelectValue placeholder={t.pickStartStep} /></SelectTrigger>
            <SelectContent>
              {steps.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.step_type === "question" ? (s.question_text || t.stepTypeQuestion) : t.resultStepLabel}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!flow.start_step_id && <p className="text-xs text-amber-600">{t.noStartStepWarning}</p>}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t.stepsLabel}</Label>
            <Button size="sm" variant="outline" onClick={() => setEditingStep("new")}>
              <Plus className="me-1 size-3.5" /> {t.addStep}
            </Button>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t.loading}</p>
          ) : steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noSteps}</p>
          ) : (
            <div className="space-y-2">
              {steps.map((step) => (
                <StepRow
                  key={step.id}
                  botId={botId}
                  step={step}
                  otherSteps={steps.filter((s) => s.id !== step.id)}
                  isStartStep={flow.start_step_id === step.id}
                  onEdit={() => setEditingStep(step)}
                  onDelete={() => setStepPendingDelete(step)}
                />
              ))}
            </div>
          )}
        </div>
      </CardContent>

      {editingStep && (
        <StepEditorDialog
          botId={botId} flowId={flow.id}
          step={editingStep === "new" ? null : editingStep}
          onClose={() => setEditingStep(null)}
        />
      )}

      <AlertDialog open={!!stepPendingDelete} onOpenChange={(v) => !v && setStepPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deleteStepConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.deleteStepConfirmDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteStep} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function StepRow({
  botId, step, otherSteps, isStartStep, onEdit, onDelete,
}: {
  botId: string;
  step: GuidedFlowStep;
  otherSteps: GuidedFlowStep[];
  isStartStep: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT("guidedFlow");
  const isQuestion = step.step_type === "question";

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            {isQuestion ? <MessageSquare className="size-4" /> : <Sparkles className="size-4" />}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {isQuestion ? (step.question_text || t.untitledQuestion) : t.resultStepLabel}
              {isStartStep && <Badge variant="outline" className="ms-2 align-middle">{t.startStepBadge}</Badge>}
            </p>
            {isQuestion && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t.optionCount.replace("{count}", String(step.options.length))}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="icon" variant="ghost" className="size-8" onClick={onEdit}><Pencil className="size-3.5" /></Button>
          <Button size="icon" variant="ghost" className="size-8 hover:text-destructive" onClick={onDelete}><Trash2 className="size-3.5" /></Button>
        </div>
      </div>

      {isQuestion && (
        <TransitionsPanel botId={botId} step={step} otherSteps={otherSteps} />
      )}
    </div>
  );
}

function TransitionsPanel({
  botId, step, otherSteps,
}: {
  botId: string;
  step: GuidedFlowStep;
  otherSteps: GuidedFlowStep[];
}) {
  const t = useT("guidedFlow");
  const { toast } = useToast();
  const { data } = useGuidedFlowTransitions(botId, step.id);
  const deleteTransition = useDeleteGuidedFlowTransition(botId, step.id);
  const [editingTransition, setEditingTransition] = useState<GuidedFlowTransition | null | "new">(null);
  const [transitionPendingDelete, setTransitionPendingDelete] = useState<GuidedFlowTransition | null>(null);

  const transitions = data?.transitions ?? [];

  function labelFor(stepId: string): string {
    const target = otherSteps.find((s) => s.id === stepId);
    if (!target) return t.unknownStep;
    return target.step_type === "question" ? (target.question_text || t.stepTypeQuestion) : t.resultStepLabel;
  }

  async function handleDelete() {
    if (!transitionPendingDelete) return;
    try {
      await deleteTransition.mutateAsync(transitionPendingDelete.id);
      setTransitionPendingDelete(null);
    } catch (err) {
      toast({ variant: "destructive", description: apiErrorMessage(err, t.deleteFailed) });
    }
  }

  return (
    <div className="mt-3 border-t pt-2 ps-9">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <GitBranch className="size-3.5" /> {t.transitionsLabel}
        </p>
        <Button
          size="sm" variant="ghost" className="h-7 px-2 text-xs"
          disabled={otherSteps.length === 0}
          onClick={() => setEditingTransition("new")}
        >
          <Plus className="me-1 size-3" /> {t.addTransition}
        </Button>
      </div>

      {transitions.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{t.noTransitions}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {transitions.map((tr) => (
            <li key={tr.id} className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1 text-xs">
              <span className="truncate">
                → <span className="font-medium">{labelFor(tr.to_step_id)}</span>
                {Object.keys(tr.condition ?? {}).length === 0 ? (
                  <span className="text-muted-foreground"> · {t.alwaysCondition}</span>
                ) : (
                  <span className="text-muted-foreground"> · {t.hasCondition}</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Button size="icon" variant="ghost" className="size-6" onClick={() => setEditingTransition(tr)}>
                  <Pencil className="size-3" />
                </Button>
                <Button size="icon" variant="ghost" className="size-6 hover:text-destructive" onClick={() => setTransitionPendingDelete(tr)}>
                  <Trash2 className="size-3" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {editingTransition && (
        <TransitionEditorDialog
          botId={botId} fromStep={step} otherSteps={otherSteps}
          transition={editingTransition === "new" ? null : editingTransition}
          onClose={() => setEditingTransition(null)}
        />
      )}

      <AlertDialog open={!!transitionPendingDelete} onOpenChange={(v) => !v && setTransitionPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deleteTransitionConfirmTitle}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
