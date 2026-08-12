/**
 * FormEditor.tsx — ویرایش کاملِ یک فرم در **یک صفحه** (باگ B12).
 *
 * در بات، مقصد فرم فقط از منوی جدای `ap:formdests` قابل ویرایش است و با
 * ویرایش خود فرم یکی نیست؛ کاربر باید بداند کدام منو کدام تکه را عوض می‌کند.
 * اینجا عنوان، فیلدها، مقصد، پیام تشکر و سوییچ‌ها همگی یک فرم‌اند و با یک
 * دکمه ذخیره می‌شوند.
 */
import { useMemo, useState } from "react";
import {
  Loader2, Save, RotateCcw, ArrowRight, Plus, Trash2, ArrowUp, ArrowDown, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";
import { useUnsavedGuard } from "@/lib/unsaved-changes";
import {
  FORM_FIELD_TYPES, apiErrorMessage, useUpdateForm,
  type BotForm, type FormField,
} from "./api";

function emptyField(order: number): FormField {
  return {
    name: "",
    label: "",
    type: "text",
    required: true,
    options: [],
    validation_regex: "",
    error_message: "",
    order,
  };
}

function fieldTypeLabel(t: ReturnType<typeof useT<"botForms">>, type: string): string {
  const key = `fieldType_${type}` as keyof typeof t;
  const label = t[key];
  return typeof label === "string" ? label : type;
}

function FieldCard({
  field,
  index,
  total,
  duplicate,
  onChange,
  onMove,
  onRemove,
}: {
  field: FormField;
  index: number;
  total: number;
  duplicate: boolean;
  onChange: (patch: Partial<FormField>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useT("botForms");

  const nameInvalid = field.name !== "" && !/^[a-zA-Z0-9_]+$/.test(field.name);
  // همان ولیدیشنی که سرور می‌کند، تا کاربر قبل از ذخیره ببیندش.
  const regexInvalid = useMemo(() => {
    if (!field.validation_regex) return false;
    try {
      new RegExp(field.validation_regex);
      return false;
    } catch {
      return true;
    }
  }, [field.validation_regex]);
  const selectWithoutOptions = field.type === "select" && field.options.length === 0;

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{t.fieldNumber.replace("{n}", String(index + 1))}</span>
        <div className="ms-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label={t.moveFieldUp} disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t.moveFieldDown} disabled={index === total - 1} onClick={() => onMove(1)}>
            <ArrowDown className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t.removeField} onClick={onRemove}>
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`f-name-${index}`}>{t.fieldName}</Label>
          <Input
            id={`f-name-${index}`}
            dir="ltr"
            value={field.name}
            onChange={(e) => onChange({ name: e.target.value })}
            aria-invalid={nameInvalid || duplicate || undefined}
          />
          {nameInvalid ? (
            <p className="text-xs text-destructive">{t.fieldNameInvalid}</p>
          ) : duplicate ? (
            <p className="text-xs text-destructive">{t.fieldNameDuplicate}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{t.fieldNameHint}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`f-label-${index}`}>{t.fieldLabel}</Label>
          <Input id={`f-label-${index}`} value={field.label} onChange={(e) => onChange({ label: e.target.value })} />
          <p className="text-xs text-muted-foreground">{t.fieldLabelHint}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`f-type-${index}`}>{t.fieldTypeLabel}</Label>
          <Select value={field.type} onValueChange={(v) => onChange({ type: v })}>
            <SelectTrigger id={`f-type-${index}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {FORM_FIELD_TYPES.map((x) => (
                <SelectItem key={x} value={x}>{fieldTypeLabel(t, x)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
          <Label htmlFor={`f-req-${index}`}>{t.fieldRequired}</Label>
          <Switch
            id={`f-req-${index}`}
            checked={field.required}
            onCheckedChange={(v) => onChange({ required: v })}
          />
        </div>
      </div>

      {field.type === "select" && (
        <div className="space-y-1.5">
          <Label htmlFor={`f-options-${index}`}>{t.fieldOptions}</Label>
          <Textarea
            id={`f-options-${index}`}
            rows={3}
            value={field.options.join("\n")}
            onChange={(e) => onChange({ options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
            aria-invalid={selectWithoutOptions || undefined}
          />
          <p className={`text-xs ${selectWithoutOptions ? "text-destructive" : "text-muted-foreground"}`}>
            {selectWithoutOptions ? t.fieldOptionsRequired : t.fieldOptionsHint}
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`f-regex-${index}`}>{t.fieldRegex}</Label>
          <Input
            id={`f-regex-${index}`}
            dir="ltr"
            className="font-mono text-sm"
            value={field.validation_regex}
            onChange={(e) => onChange({ validation_regex: e.target.value })}
            aria-invalid={regexInvalid || undefined}
          />
          <p className={`text-xs ${regexInvalid ? "text-destructive" : "text-muted-foreground"}`}>
            {regexInvalid ? t.fieldRegexInvalid : t.fieldRegexHint}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`f-error-${index}`}>{t.fieldErrorMessage}</Label>
          <Input
            id={`f-error-${index}`}
            value={field.error_message}
            onChange={(e) => onChange({ error_message: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">{t.fieldErrorMessageHint}</p>
        </div>
      </div>
    </div>
  );
}

export function FormEditor({
  botId,
  form,
  onBack,
}: {
  botId: string;
  form: BotForm;
  onBack: () => void;
}) {
  const t = useT("botForms");
  const { toast } = useToast();
  const update = useUpdateForm(botId);

  const [draft, setDraft] = useState<BotForm>(form);

  const dirty = JSON.stringify(draft) !== JSON.stringify(form);
  useUnsavedGuard(`form:${form.id}`, dirty);

  const nameCounts = new Map<string, number>();
  for (const f of draft.fields) nameCounts.set(f.name, (nameCounts.get(f.name) ?? 0) + 1);

  const invalid =
    !draft.title.trim() ||
    draft.fields.some(
      (f) =>
        !f.name ||
        !/^[a-zA-Z0-9_]+$/.test(f.name) ||
        (nameCounts.get(f.name) ?? 0) > 1 ||
        !f.label.trim() ||
        (f.type === "select" && f.options.length === 0)
    );

  function setField(index: number, patch: Partial<FormField>) {
    setDraft((prev) => ({
      ...prev,
      fields: prev.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    }));
  }

  function moveField(index: number, delta: -1 | 1) {
    const target = index + delta;
    setDraft((prev) => {
      if (target < 0 || target >= prev.fields.length) return prev;
      const fields = [...prev.fields];
      [fields[index], fields[target]] = [fields[target], fields[index]];
      // `order` هم همین‌جا هماهنگ می‌شود؛ سرور دوباره نرمالش می‌کند.
      return { ...prev, fields: fields.map((f, i) => ({ ...f, order: i })) };
    });
  }

  function save() {
    if (invalid) {
      toast({ variant: "destructive", title: t.fixErrorsFirst });
      return;
    }
    update.mutate(
      {
        formId: form.id,
        patch: {
          title: draft.title.trim(),
          fields: draft.fields,
          destination_group: draft.destination_group,
          destination_admin_ids: draft.destination_admin_ids,
          thank_you_message: draft.thank_you_message,
          is_active: draft.is_active,
          notify_admin: draft.notify_admin,
          allow_edit: draft.allow_edit,
        },
      },
      {
        onSuccess: () => toast({ title: t.formSaved }),
        onError: (err: any) =>
          toast({ variant: "destructive", title: t.errorGeneric, description: apiErrorMessage(err, t.errorGeneric) }),
      }
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowRight className="me-1.5 size-4 rtl-flip" /> {t.backToList}
        </Button>
        <h3 className="min-w-0 flex-1 truncate text-lg font-semibold">{draft.title || t.untitledForm}</h3>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.basicsTitle}</CardTitle>
          <CardDescription>{t.basicsDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="form-title">{t.formTitle}</Label>
            <Input
              id="form-title"
              value={draft.title}
              onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
              aria-invalid={!draft.title.trim() || undefined}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="form-thanks">{t.thankYouMessage}</Label>
            <Textarea
              id="form-thanks"
              rows={2}
              value={draft.thank_you_message}
              onChange={(e) => setDraft((p) => ({ ...p, thank_you_message: e.target.value }))}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex items-center justify-between gap-2 rounded-md border p-3">
              <Label htmlFor="form-active">{t.isActive}</Label>
              <Switch id="form-active" checked={draft.is_active} onCheckedChange={(v) => setDraft((p) => ({ ...p, is_active: v }))} />
            </div>
            <div className="flex items-center justify-between gap-2 rounded-md border p-3">
              <Label htmlFor="form-notify">{t.notifyAdmin}</Label>
              <Switch id="form-notify" checked={draft.notify_admin} onCheckedChange={(v) => setDraft((p) => ({ ...p, notify_admin: v }))} />
            </div>
            <div className="flex items-center justify-between gap-2 rounded-md border p-3">
              <Label htmlFor="form-edit">{t.allowEdit}</Label>
              <Switch id="form-edit" checked={draft.allow_edit} onCheckedChange={(v) => setDraft((p) => ({ ...p, allow_edit: v }))} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* باگ B12: مقصد همین‌جاست، نه در یک منوی جدا. */}
      <Card>
        <CardHeader>
          <CardTitle>{t.destinationTitle}</CardTitle>
          <CardDescription>{t.destinationDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="form-dest">{t.destinationGroup}</Label>
            <Input
              id="form-dest"
              dir="ltr"
              value={draft.destination_group}
              onChange={(e) => setDraft((p) => ({ ...p, destination_group: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">{t.destinationGroupHint}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="form-admins">{t.destinationAdmins}</Label>
            <Textarea
              id="form-admins"
              rows={2}
              dir="ltr"
              value={draft.destination_admin_ids.join("\n")}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  destination_admin_ids: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                }))
              }
            />
            <p className="text-xs text-muted-foreground">{t.destinationAdminsHint}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.fieldsTitle}</CardTitle>
          <CardDescription>{t.fieldsDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {draft.fields.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t.noFields}
            </p>
          ) : (
            draft.fields.map((field, index) => (
              <FieldCard
                key={index}
                field={field}
                index={index}
                total={draft.fields.length}
                duplicate={(nameCounts.get(field.name) ?? 0) > 1 && field.name !== ""}
                onChange={(patch) => setField(index, patch)}
                onMove={(delta) => moveField(index, delta)}
                onRemove={() =>
                  setDraft((p) => ({
                    ...p,
                    fields: p.fields.filter((_, i) => i !== index).map((f, i) => ({ ...f, order: i })),
                  }))
                }
              />
            ))
          )}
          <Button
            variant="outline"
            onClick={() => setDraft((p) => ({ ...p, fields: [...p.fields, emptyField(p.fields.length)] }))}
          >
            <Plus className="me-1.5 size-4" /> {t.addField}
          </Button>
        </CardContent>
      </Card>

      {invalid && (
        <p className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" /> {t.fixErrorsFirst}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button onClick={save} disabled={!dirty || invalid || update.isPending}>
          {update.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <Save className="me-2 size-4" />}
          {t.save}
        </Button>
        <Button variant="ghost" onClick={() => setDraft(form)} disabled={!dirty || update.isPending}>
          <RotateCcw className="me-2 size-4" /> {t.revert}
        </Button>
        {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">{t.unsavedBadge}</span>}
      </div>
    </div>
  );
}
