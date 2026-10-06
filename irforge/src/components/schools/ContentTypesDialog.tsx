import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, TriangleAlert } from "lucide-react";
import { useT } from "@/hooks/use-translation";
import type { SchoolContentType } from "@/lib/schools-api";
import { CONTENT_TYPE_ORDER, TYPE_LABEL_KEY, TYPE_META } from "@/lib/schools-subject-style";

/**
 * «تنظیماتِ» انواعِ محتوا — پنج سوییچ (لغت‌نامه/اشعار/فرمول‌ها/جزوه‌ها/کتاب‌ها).
 * - mode="subject": پیش‌فرضِ کلِ درس.
 * - mode="lesson": override برایِ یک جلسه؛ سوییچِ بالا «پیروی از تنظیماتِ درس»
 *   یعنی override=null (مجموعه‌یِ مؤثر = پیش‌فرضِ درس). مجموعه‌یِ مؤثر =
 *   override ?? پیش‌فرضِ درس.
 * خاموش‌کردنِ *همه‌یِ* انواع مجاز است ولی بی‌صدا نیست: یک هشدارِ صریح نشان
 * می‌دهد که دانش‌آموزان هیچ‌چیز نخواهند دید.
 */
export function ContentTypesDialog({
  open,
  onOpenChange,
  mode,
  title,
  current,
  subjectTypes,
  saving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "subject" | "lesson";
  title: string;
  /** subject: پیش‌فرضِ فعلی. lesson: overrideِ فعلی یا null (=ارث‌بری). */
  current: SchoolContentType[] | null;
  /** فقط در mode="lesson": پیش‌فرضِ درس برایِ نمایشِ حالتِ «پیروی». */
  subjectTypes?: SchoolContentType[];
  saving: boolean;
  onSave: (types: SchoolContentType[] | null) => void;
}) {
  const t = useT("schools") as any;
  const [inherit, setInherit] = useState(mode === "lesson" && current === null);
  const [selected, setSelected] = useState<SchoolContentType[]>(current ?? subjectTypes ?? []);

  // هر بار که دیالوگ باز می‌شود از مقدارِ فعلی شروع کن (نه از ویرایشِ نیمه‌کاره‌یِ دفعه‌یِ قبل).
  useEffect(() => {
    if (open) {
      setInherit(mode === "lesson" && current === null);
      setSelected(current ?? subjectTypes ?? []);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = mode === "lesson" && inherit ? (subjectTypes ?? []) : selected;
  const allOff = shown.length === 0;

  function toggle(tp: SchoolContentType, on: boolean) {
    setSelected((prev) => CONTENT_TYPE_ORDER.filter((x) => (x === tp ? on : prev.includes(x))));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{mode === "subject" ? t.typesSettingsSubjectHint : t.typesSettingsLessonHint}</DialogDescription>
        </DialogHeader>

        {mode === "lesson" && (
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2">
            <span className="text-sm font-medium">{t.typesInheritSwitch}</span>
            <Switch checked={inherit} onCheckedChange={setInherit} />
          </label>
        )}

        <div className="flex flex-col gap-2">
          {CONTENT_TYPE_ORDER.map((tp) => {
            const { Icon, color } = TYPE_META[tp];
            const on = shown.includes(tp);
            const disabled = mode === "lesson" && inherit;
            return (
              <label
                key={tp}
                className={`flex min-h-12 items-center justify-between gap-3 rounded-lg border px-3 py-2 transition ${disabled ? "opacity-60" : "cursor-pointer hover:bg-muted/50"}`}
              >
                <span className="flex items-center gap-3">
                  <span className={`flex size-9 items-center justify-center rounded-md ${color.chip}`}>
                    <Icon className="size-5" />
                  </span>
                  <span className="text-sm font-medium">{t[TYPE_LABEL_KEY[tp]]}</span>
                </span>
                <Switch checked={on} disabled={disabled} onCheckedChange={(v) => toggle(tp, v)} data-testid={`switch-type-${tp}`} />
              </label>
            );
          })}
        </div>

        {allOff && (
          <Alert variant="destructive">
            <TriangleAlert className="size-4" />
            <AlertDescription>{t.typesAllOffWarning}</AlertDescription>
          </Alert>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t.cancel}</Button>
          <Button disabled={saving} onClick={() => onSave(mode === "lesson" && inherit ? null : selected)}>
            {saving && <Loader2 className="me-2 size-4 animate-spin" />}
            {t.saveButton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
