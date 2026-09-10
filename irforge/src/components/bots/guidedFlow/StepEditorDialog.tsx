/**
 * guidedFlow/StepEditorDialog.tsx — IRFORGE_GUIDED_FLOW_INVITE_CARD_PROMPT
 * فازِ B1.
 *
 * افزودن/ویرایشِ یک گام. نوعِ گام فقط موقعِ ساخت انتخاب می‌شود (تغییرِ نوع
 * بعد از ساخت یعنی داده‌ی طرفِ دیگر بی‌معنی می‌شود — همان قاعده‌ای که
 * `PanelEditor.tsx` هم برایِ تغییرِ نوعِ پنل با یک هشدارِ صریح رعایت می‌کند؛
 * اینجا برای سادگی به‌جایِ هشدار، تغییرِ نوع بعد از ساخت اصلاً ممکن نیست).
 *
 * محتوایِ «نتیجه» دقیقاً همان کامپوننت‌هایی را reuse می‌کند که برایِ محصولِ
 * کاتالوگ ساخته شدند (خواسته‌ی صریحِ پرامپت): `MediaList` (تصویر، دقیقاً
 * همان `accept="image/*"`ی CatalogSection.tsx) و `ButtonBuilder`
 * (`panel-buttons.ts`ی rows model). برایِ بدنه‌ی HTML، به‌جایِ Textareaی
 * خامِ CatalogSection.tsx، از `TelegramHtmlEditor` (پستباکس) استفاده شده —
 * قراردادِ داده (`body_html: string`, همان sanitize_telegram_html سمتِ
 * سرور) عیناً یکی است، فقط ابزارِ نویسندگی جدیدتر و امن‌تر است (تولبارِ
 * whitelist، شمارنده‌ی کاراکتر) — دقیقاً همان چیزی که پستباکس ساخته شد تا
 * جایگزینِ این الگو کند؛ این انحراف در PROGRESS.md مستند شده.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";
import { MediaList } from "../panels/MediaList";
import { ButtonBuilder } from "../panels/ButtonBuilder";
import { usePanels } from "../panels/api";
import { TelegramHtmlEditor } from "../postbox/TelegramHtmlEditor";
import { buttonsToRows, rowsToButtons, type PanelButton } from "@/lib/panel-buttons";
import {
  apiErrorMessage, useCreateGuidedFlowStep, useUpdateGuidedFlowStep,
  type FlowOption, type GuidedFlowStep, type StepInput, type StepType,
} from "./api";

export function StepEditorDialog({
  botId, flowId, step, onClose,
}: {
  botId: string;
  flowId: string;
  step: GuidedFlowStep | null;
  onClose: () => void;
}) {
  const t = useT("guidedFlow");
  const { toast } = useToast();
  const createStep = useCreateGuidedFlowStep(botId, flowId);
  const updateStep = useUpdateGuidedFlowStep(botId, flowId);
  const { data: panelsData } = usePanels(botId);

  const [stepType] = useState<StepType>(step?.step_type ?? "question");
  const [questionText, setQuestionText] = useState(step?.question_text ?? "");
  const [options, setOptions] = useState<FlowOption[]>(
    step?.options?.length ? step.options : [{ label: "", value: "" }],
  );
  const [mediaFileIds, setMediaFileIds] = useState<string[]>(step?.media?.map((m) => m.file_id) ?? []);
  const [bodyHtml, setBodyHtml] = useState(step?.body_html ?? "");
  const [rows, setRows] = useState<PanelButton[][]>(buttonsToRows(step?.buttons ?? []));

  const saving = createStep.isPending || updateStep.isPending;

  function updateOption(index: number, patch: Partial<FlowOption>) {
    setOptions(options.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  }
  function addOption() {
    setOptions([...options, { label: "", value: "" }]);
  }
  function removeOption(index: number) {
    setOptions(options.filter((_, i) => i !== index));
  }

  async function handleSave() {
    const payload: StepInput =
      stepType === "question"
        ? {
            step_type: "question",
            question_text: questionText,
            options: options.filter((o) => o.label.trim() && o.value.trim()),
          }
        : {
            step_type: "result",
            media: mediaFileIds.map((fileId) => ({ type: "photo" as const, file_id: fileId, caption: "" })),
            body_html: bodyHtml,
            buttons: rowsToButtons(rows),
          };
    try {
      if (step) await updateStep.mutateAsync({ stepId: step.id, patch: payload });
      else await createStep.mutateAsync(payload);
      onClose();
    } catch (err) {
      toast({ variant: "destructive", description: apiErrorMessage(err, t.saveFailed) });
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{step ? t.editStep : t.addStep}</DialogTitle>
        </DialogHeader>

        {!step && (
          <div className="space-y-1">
            <Label>{t.stepTypeLabel}</Label>
            <Select value={stepType} disabled>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="question">{t.stepTypeQuestion}</SelectItem>
                <SelectItem value="result">{t.stepTypeResult}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {stepType === "question" ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t.questionTextLabel}</Label>
              <Textarea
                rows={2} maxLength={500} dir="rtl"
                value={questionText}
                onChange={(e) => setQuestionText(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t.optionsLabel}</Label>
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    placeholder={t.optionLabelPlaceholder} value={opt.label}
                    onChange={(e) => updateOption(i, { label: e.target.value })}
                  />
                  <Input
                    placeholder={t.optionValuePlaceholder} dir="ltr" value={opt.value}
                    onChange={(e) => updateOption(i, { value: e.target.value })}
                  />
                  <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => removeOption(i)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addOption}>
                <Plus className="me-1 size-3.5" /> {t.addOption}
              </Button>
            </div>
          </div>
        ) : (
          <Tabs defaultValue="content">
            <TabsList>
              <TabsTrigger value="content">{t.tabContent}</TabsTrigger>
              <TabsTrigger value="buttons">{t.tabButtons}</TabsTrigger>
            </TabsList>
            <TabsContent value="content" className="space-y-3 pt-2">
              <div className="space-y-1">
                <Label>{t.mediaLabel}</Label>
                <MediaList botId={botId} fileIds={mediaFileIds} multiple accept="image/*" onChange={setMediaFileIds} />
              </div>
              <div className="space-y-1">
                <Label>{t.bodyHtmlLabel}</Label>
                <TelegramHtmlEditor value={bodyHtml} onChange={setBodyHtml} rows={5} />
              </div>
            </TabsContent>
            <TabsContent value="buttons" className="pt-2">
              <ButtonBuilder
                botId={botId} rows={rows} panels={panelsData?.panels ?? []} forms={[]}
                catalog={undefined} onChange={setRows}
              />
            </TabsContent>
          </Tabs>
        )}

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
