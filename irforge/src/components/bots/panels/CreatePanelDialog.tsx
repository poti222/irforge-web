/**
 * CreatePanelDialog.tsx — ساخت پنل، مرحله‌ای ولی **در یک دیالوگ**.
 *
 * در بات، ساخت پنل یک FSM چندپیامی است: عنوان بفرست، نوع را انتخاب کن، محتوا
 * بفرست… و اگر وسط کار بروی، همه‌چیز می‌پرد. اینجا هر چهار مرحله در یک دیالوگ
 * زندگی می‌کنند، عقب‌وجلو رفتن آزاد است و تا لحظه‌ی «ساخت» چیزی به سرور نمی‌رود.
 */
import { useState } from "react";
import { Loader2, ChevronRight, ChevronLeft } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, useCreatePanel, type Panel, type PanelCatalog } from "./api";
import { panelTypeLabel } from "./labels";

const STEPS = ["title", "type", "content", "parent"] as const;
type Step = (typeof STEPS)[number];

export function CreatePanelDialog({
  botId,
  panels,
  catalog,
  open,
  onOpenChange,
  onCreated,
}: {
  botId: string;
  panels: Panel[];
  catalog: PanelCatalog | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (panel: Panel) => void;
}) {
  const t = useT("botPanels");
  const { toast } = useToast();
  const create = useCreatePanel(botId);

  const [step, setStep] = useState<Step>("title");
  const [title, setTitle] = useState("");
  const [type, setType] = useState("text");
  const [content, setContent] = useState("");
  const [mediaFileId, setMediaFileId] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const types = catalog?.panelTypes ?? ["text"];
  const textOnly = catalog?.textOnlyTypes ?? ["text", "form", "sell"];
  const needsMedia = !textOnly.includes(type);

  function reset() {
    setStep("title");
    setTitle("");
    setType("text");
    setContent("");
    setMediaFileId("");
    setParentId("");
    setFieldError(null);
  }

  function next() {
    // خطای فیلد، نه یک toast مبهم: کاربر باید بداند کدام ورودی مشکل دارد.
    if (step === "title" && !title.trim()) {
      setFieldError(t.errorTitleRequired);
      return;
    }
    setFieldError(null);
    const index = STEPS.indexOf(step);
    if (index < STEPS.length - 1) setStep(STEPS[index + 1]);
  }

  function back() {
    setFieldError(null);
    const index = STEPS.indexOf(step);
    if (index > 0) setStep(STEPS[index - 1]);
  }

  function submit() {
    if (!title.trim()) {
      setStep("title");
      setFieldError(t.errorTitleRequired);
      return;
    }
    create.mutate(
      {
        title: title.trim(),
        type,
        content,
        media_file_id: mediaFileId.trim(),
        parent_id: parentId || null,
      },
      {
        onSuccess: ({ panel }) => {
          toast({ title: t.panelCreated });
          onCreated(panel);
          onOpenChange(false);
          reset();
        },
        onError: (err: any) =>
          setFieldError(apiErrorMessage(err, t.errorGeneric)),
      }
    );
  }

  const stepIndex = STEPS.indexOf(step);
  const isLast = stepIndex === STEPS.length - 1;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.createPanelTitle}</DialogTitle>
          <DialogDescription>
            {t.createStepOf.replace("{step}", String(stepIndex + 1)).replace("{total}", String(STEPS.length))}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {step === "title" && (
            <div className="space-y-1.5">
              <Label htmlFor="cp-title">{t.fieldTitle}</Label>
              <Input
                id="cp-title"
                value={title}
                autoFocus
                onChange={(e) => { setTitle(e.target.value); setFieldError(null); }}
                onKeyDown={(e) => e.key === "Enter" && next()}
                aria-invalid={Boolean(fieldError) || undefined}
              />
            </div>
          )}

          {step === "type" && (
            <div className="space-y-1.5">
              <Label htmlFor="cp-type">{t.fieldType}</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="cp-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {types.map((x) => (
                    <SelectItem key={x} value={x}>{panelTypeLabel(t, x)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t.fieldTypeHint}</p>
            </div>
          )}

          {step === "content" && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="cp-content">{t.fieldContent}</Label>
                <Textarea id="cp-content" rows={4} value={content} onChange={(e) => setContent(e.target.value)} />
              </div>
              {needsMedia && (
                <div className="space-y-1.5">
                  <Label htmlFor="cp-media">{t.fieldMediaFileId}</Label>
                  <Input id="cp-media" dir="ltr" className="font-mono text-sm" value={mediaFileId} onChange={(e) => setMediaFileId(e.target.value)} />
                  {/* آپلود واقعی در ویرایشگر پنل هست؛ اینجا عمداً ساده نگه داشته
                      شده تا دیالوگ ساخت سنگین نشود. */}
                  <p className="text-xs text-muted-foreground">{t.fieldMediaHint}</p>
                </div>
              )}
            </div>
          )}

          {step === "parent" && (
            <div className="space-y-1.5">
              <Label htmlFor="cp-parent">{t.fieldParent}</Label>
              <Select value={parentId || "__none__"} onValueChange={(v) => setParentId(v === "__none__" ? "" : v)}>
                <SelectTrigger id="cp-parent"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t.noParent}</SelectItem>
                  {panels.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.title || p.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t.fieldParentHint}</p>
            </div>
          )}

          {fieldError && <p className="text-sm text-destructive">{fieldError}</p>}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={back} disabled={stepIndex === 0 || create.isPending}>
            <ChevronRight className="me-1.5 size-4 rtl-flip" /> {t.back}
          </Button>
          {isLast ? (
            <Button onClick={submit} disabled={create.isPending}>
              {create.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.createPanelCta}
            </Button>
          ) : (
            <Button onClick={next} disabled={create.isPending}>
              {t.next} <ChevronLeft className="ms-1.5 size-4 rtl-flip" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
