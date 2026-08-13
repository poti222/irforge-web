/**
 * CreatePanelDialog.tsx — ساخت پنل، مرحله‌ای ولی **در یک دیالوگ**.
 *
 * در بات، ساخت پنل یک FSM چندپیامی است: عنوان بفرست، نوع را انتخاب کن، محتوا
 * بفرست… و اگر وسط کار بروی، همه‌چیز می‌پرد. اینجا هر سه مرحله در یک دیالوگ
 * زندگی می‌کنند، عقب‌وجلو رفتن آزاد است و تا لحظه‌ی «ساخت» چیزی به سرور نمی‌رود.
 *
 * فاز ۲ (اسپک panel-builder): مرحلهٔ «نوع» را فاز ۱ حذف کرد؛ اینجا آپلودگر
 * واقعی (`MediaList`) وصل می‌شود و `type` قبل از submit خودکار محاسبه می‌شود:
 *   فقط متن → text | ۱ عکس → photo | چند عکس → carousel
 *   ویدیو → video | صوت → audio | فایل → document
 *   نه متن نه مدیا → جلوی submit گرفته می‌شود.
 * انواع خاص (form/sell/پلاگینی) که با این منطق حدس‌زدنی نیستند پشت دکمهٔ
 * ثانویهٔ «نوع خاص…» می‌مانند و فقط با انتخاب صریح کاربر فعال می‌شوند.
 */
import { useMemo, useState } from "react";
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
import { MediaList, type MediaKind } from "./MediaList";
import { panelTypeLabel } from "./labels";

const STEPS = ["title", "content", "parent"] as const;
type Step = (typeof STEPS)[number];

/** نوع‌هایی که از روی متن/مدیا خودکار حدس زده می‌شوند؛ بقیه‌ی catalog.panelTypes «خاص» هستند. */
const AUTO_GUESSABLE_TYPES = ["text", "photo", "carousel", "video", "audio", "document"];

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
  const [content, setContent] = useState("");
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [mediaKind, setMediaKind] = useState<MediaKind | null>(null);
  const [parentId, setParentId] = useState<string>("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  // نوع خاص (form/sell/پلاگینی): پیش‌فرض بسته است، فقط با کلیک روی «نوع
  // خاص…» باز می‌شود. وقتی مقدار دارد، جای تشخیص خودکار را می‌گیرد.
  const [showSpecialType, setShowSpecialType] = useState(false);
  const [specialType, setSpecialType] = useState<string>("");

  const specialTypes = useMemo(
    () => (catalog?.panelTypes ?? []).filter((x) => !AUTO_GUESSABLE_TYPES.includes(x)),
    [catalog]
  );

  function reset() {
    setStep("title");
    setTitle("");
    setContent("");
    setMediaIds([]);
    setMediaKind(null);
    setParentId("");
    setFieldError(null);
    setShowSpecialType(false);
    setSpecialType("");
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

  /** تشخیص خودکار type از روی محتوا/مدیا، مگر اینکه یک «نوع خاص» صریحاً انتخاب شده باشد. */
  function resolveType(): { type: string; error: string | null } {
    if (specialType) return { type: specialType, error: null };

    const hasText = content.trim().length > 0;
    const hasMedia = mediaIds.length > 0;

    if (!hasText && !hasMedia) {
      // TODO(فاز ۳): این پیام باید یک کلید i18n بگیرد.
      return { type: "", error: "یا متنی بنویس، یا مدیایی اضافه کن." };
    }
    if (hasMedia && mediaKind) {
      if (mediaKind === "photo") return { type: mediaIds.length > 1 ? "carousel" : "photo", error: null };
      return { type: mediaKind, error: null }; // video/audio/document نامشون دقیقاً با type یکیه
    }
    return { type: "text", error: null };
  }

  function submit() {
    if (!title.trim()) {
      setStep("title");
      setFieldError(t.errorTitleRequired);
      return;
    }
    const { type, error } = resolveType();
    if (error) {
      setStep("content");
      setFieldError(error);
      return;
    }
    create.mutate(
      {
        title: title.trim(),
        type,
        content,
        // مدیای اول برای پیام تکی، لیست کامل برای کاروسل — همان قراردادِ PanelEditor.
        media_file_id: mediaIds[0] ?? "",
        ...(type === "carousel" ? { settings: { carousel_ids: mediaIds } } : {}),
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

          {step === "content" && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="cp-content">{t.fieldContent}</Label>
                <Textarea id="cp-content" rows={4} value={content} onChange={(e) => setContent(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label>{t.fieldMediaList}</Label>
                <MediaList
                  botId={botId}
                  fileIds={mediaIds}
                  multiple
                  onChange={setMediaIds}
                  onKindChange={setMediaKind}
                />
                <p className="text-xs text-muted-foreground">{t.fieldMediaHint}</p>
              </div>

              {!showSpecialType ? (
                <Button
                  type="button" variant="link" size="sm" className="h-auto p-0 text-xs text-muted-foreground"
                  onClick={() => setShowSpecialType(true)}
                >
                  {/* TODO(فاز ۳): این متن باید یک کلید i18n بگیرد. */}
                  نوع خاص… (فرم، فروش و مشابه)
                </Button>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="cp-special-type">{t.fieldType}</Label>
                  <Select
                    value={specialType || "__auto__"}
                    onValueChange={(v) => setSpecialType(v === "__auto__" ? "" : v)}
                  >
                    <SelectTrigger id="cp-special-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {/* TODO(فاز ۳): این متن باید یک کلید i18n بگیرد. */}
                      <SelectItem value="__auto__">تشخیص خودکار</SelectItem>
                      {specialTypes.map((x) => (
                        <SelectItem key={x} value={x}>{panelTypeLabel(t, x)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t.fieldTypeHint}</p>
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
