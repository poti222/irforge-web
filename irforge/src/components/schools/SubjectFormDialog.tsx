import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useT } from "@/hooks/use-translation";
import { SUBJECT_COLORS, SUBJECT_COLOR_KEYS, SUBJECT_ICONS, SUBJECT_ICON_KEYS, subjectStyle } from "@/lib/schools-subject-style";

/** فرمِ ساخت/ویرایشِ یک «موضوع» (نام + آیکن + رنگ) — فقط برایِ مدیر. */
export function SubjectFormDialog({
  open,
  onOpenChange,
  initial,
  saving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: { name: string; icon: string | null; color: string | null } | null;
  saving: boolean;
  onSubmit: (v: { name: string; icon: string; color: string }) => void;
}) {
  const t = useT("schools") as any;
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("book-open");
  const [color, setColor] = useState("blue");

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setIcon(initial?.icon && SUBJECT_ICONS[initial.icon] ? initial.icon : "book-open");
      setColor(initial?.color && SUBJECT_COLORS[initial.color] ? initial.color : "blue");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const { Icon, color: c } = subjectStyle({ icon, color });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? t.subjectEditTitle : t.subjectCreateTitle}</DialogTitle>
          <DialogDescription>{t.subjectFormHint}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
          <span className={`flex size-12 items-center justify-center rounded-xl ${c.chip}`}>
            <Icon className="size-6" />
          </span>
          <span className="truncate text-base font-bold" dir="auto">{name.trim() || t.subjectNamePlaceholder}</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="subject-name">{t.subjectNameField}</Label>
          <Input id="subject-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t.subjectNamePlaceholder} dir="auto" autoFocus />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>{t.subjectIconField}</Label>
          <div className="grid grid-cols-8 gap-1.5 sm:gap-2">
            {SUBJECT_ICON_KEYS.map((k) => {
              const I = SUBJECT_ICONS[k];
              return (
                <button
                  key={k}
                  type="button"
                  aria-label={k}
                  aria-pressed={icon === k}
                  onClick={() => setIcon(k)}
                  className={`flex aspect-square min-h-10 items-center justify-center rounded-lg border transition ${icon === k ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}
                >
                  <I className="size-5" />
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>{t.subjectColorField}</Label>
          <div className="flex flex-wrap gap-2">
            {SUBJECT_COLOR_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                aria-label={k}
                aria-pressed={color === k}
                onClick={() => setColor(k)}
                className={`size-10 rounded-full border-2 transition ${SUBJECT_COLORS[k].swatch} ${color === k ? "border-foreground ring-2 ring-primary/40" : "border-transparent"}`}
              />
            ))}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t.cancel}</Button>
          <Button disabled={saving || !name.trim()} onClick={() => onSubmit({ name: name.trim(), icon, color })}>
            {saving && <Loader2 className="me-2 size-4 animate-spin" />}
            {t.saveButton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
