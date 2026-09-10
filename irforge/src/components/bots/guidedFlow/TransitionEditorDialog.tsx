/**
 * guidedFlow/TransitionEditorDialog.tsx — IRFORGE_GUIDED_FLOW_INVITE_CARD_PROMPT
 * فازِ B1. افزودن/ویرایشِ یک یال (transition) از یک گامِ سؤال به گامِ بعدی:
 * گامِ مقصد + شرط (`ConditionBuilder`) + اولویت (عددِ کوچک‌تر = زودتر بررسی
 * می‌شود — همان چیزی که `guidedFlowStore.ts::listTransitions` مرتب می‌کند).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";
import { ConditionBuilder, type FieldOption } from "./ConditionBuilder";
import {
  apiErrorMessage, useCreateGuidedFlowTransition, useUpdateGuidedFlowTransition,
  type FlowCondition, type GuidedFlowStep, type GuidedFlowTransition,
} from "./api";

export function TransitionEditorDialog({
  botId, fromStep, otherSteps, transition, onClose,
}: {
  botId: string;
  fromStep: GuidedFlowStep;
  /** گام‌هایِ دیگرِ همینِ flow — مقصدهایِ ممکن (خودِ گام نمی‌تواند مقصدِ خودش باشد). */
  otherSteps: GuidedFlowStep[];
  transition: GuidedFlowTransition | null;
  onClose: () => void;
}) {
  const t = useT("guidedFlow");
  const { toast } = useToast();
  const createTransition = useCreateGuidedFlowTransition(botId, fromStep.id);
  const updateTransition = useUpdateGuidedFlowTransition(botId, fromStep.id);

  const [toStepId, setToStepId] = useState(transition?.to_step_id ?? otherSteps[0]?.id ?? "");
  const [condition, setCondition] = useState<FlowCondition>(transition?.condition ?? {});
  const [priority, setPriority] = useState(String(transition?.priority ?? 0));

  const saving = createTransition.isPending || updateTransition.isPending;

  const fieldOptions: FieldOption[] = [
    { id: fromStep.id, label: fromStep.question_text || t.stepTypeQuestion },
  ];

  async function handleSave() {
    if (!toStepId) {
      toast({ variant: "destructive", description: t.pickDestinationStep });
      return;
    }
    const patch = { to_step_id: toStepId, condition, priority: Number(priority) || 0 };
    try {
      if (transition) await updateTransition.mutateAsync({ transitionId: transition.id, patch });
      else await createTransition.mutateAsync(patch);
      onClose();
    } catch (err) {
      toast({ variant: "destructive", description: apiErrorMessage(err, t.saveFailed) });
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{transition ? t.editTransition : t.addTransition}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t.destinationStepLabel}</Label>
            <Select value={toStepId} onValueChange={setToStepId}>
              <SelectTrigger><SelectValue placeholder={t.pickDestinationStep} /></SelectTrigger>
              <SelectContent>
                {otherSteps.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.step_type === "question" ? (s.question_text || t.stepTypeQuestion) : t.resultStepLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>{t.conditionLabel}</Label>
            <p className="text-xs text-muted-foreground">{t.conditionHelp}</p>
            <ConditionBuilder value={condition} onChange={setCondition} fieldOptions={fieldOptions} />
          </div>

          <div className="space-y-1">
            <Label>{t.priorityLabel}</Label>
            <p className="text-xs text-muted-foreground">{t.priorityHelp}</p>
            <Input type="number" dir="ltr" className="w-24" value={priority} onChange={(e) => setPriority(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t.cancel}</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="me-1.5 size-4 animate-spin" />}
            {t.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
