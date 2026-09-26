/**
 * IntakeFieldsEditor.tsx — PHASE 34
 *
 * Pre-payment intake fields for a catalog item: info the buyer must
 * provide before checkout (address, phone, location, or an admin-defined
 * multi-select of add-ons) — mirrors Forms' own field editor UX
 * (FormEditor.tsx's FieldCard) but for `CatalogItem.required_intake_fields`,
 * a separate array with its own type vocabulary that adds "multi_select"
 * (an admin-defined multi-choice list the buyer can tick more than one of
 * — doesn't exist anywhere in Forms). Deliberately narrower than Forms'
 * field editor: no validation_regex/error_message, which are Forms-specific
 * power-user features not asked for here.
 */
import { useMemo } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";

export const INTAKE_FIELD_TYPES = [
  "text", "number", "phone", "share_phone", "location", "select", "multi_select",
] as const;

export type IntakeField = {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
};

export function emptyIntakeField(): IntakeField {
  return { name: "", label: "", type: "text", required: true, options: [] };
}

function IntakeFieldCard({
  field, index, total, duplicate, onChange, onMove, onRemove,
}: {
  field: IntakeField;
  index: number;
  total: number;
  duplicate: boolean;
  onChange: (patch: Partial<IntakeField>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useT("botCatalog");
  const nameInvalid = field.name !== "" && !/^[a-zA-Z0-9_]+$/.test(field.name);
  const needsOptions = field.type === "select" || field.type === "multi_select";
  const optionsMissing = needsOptions && field.options.length === 0;

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{t.intakeFieldNumber.replace("{n}", String(index + 1))}</span>
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
          <Label>{t.intakeFieldName}</Label>
          <Input
            dir="ltr" placeholder="delivery_address"
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
          <Label>{t.intakeFieldLabel}</Label>
          <Input
            placeholder={t.intakeFieldLabelPlaceholder}
            value={field.label}
            onChange={(e) => onChange({ label: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label>{t.intakeFieldTypeLabel}</Label>
          <Select value={field.type} onValueChange={(v) => onChange({ type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {INTAKE_FIELD_TYPES.map((x) => (
                <SelectItem key={x} value={x}>{(t as Record<string, string>)[`intakeFieldType_${x}`] ?? x}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
          <Label>{t.fieldRequired}</Label>
          <Switch checked={field.required} onCheckedChange={(v) => onChange({ required: v })} />
        </div>
      </div>

      {needsOptions && (
        <div className="space-y-1.5">
          <Label>{t.fieldOptions}</Label>
          <Textarea
            rows={3}
            placeholder={t.fieldOptionsPlaceholder}
            value={field.options.join("\n")}
            onChange={(e) => onChange({ options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
            aria-invalid={optionsMissing || undefined}
          />
          <p className={`text-xs ${optionsMissing ? "text-destructive" : "text-muted-foreground"}`}>
            {optionsMissing ? t.fieldOptionsRequired : (field.type === "multi_select" ? t.intakeMultiSelectHint : t.fieldOptionsHint)}
          </p>
        </div>
      )}
    </div>
  );
}

export function IntakeFieldsEditor({
  fields, onChange,
}: {
  fields: IntakeField[];
  onChange: (fields: IntakeField[]) => void;
}) {
  const t = useT("botCatalog");
  const nameCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of fields) m.set(f.name, (m.get(f.name) ?? 0) + 1);
    return m;
  }, [fields]);

  function setField(index: number, patch: Partial<IntakeField>) {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }
  function moveField(index: number, delta: -1 | 1) {
    const next = [...fields];
    const j = index + delta;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    onChange(next);
  }
  function removeField(index: number) {
    onChange(fields.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-3">
      {fields.map((f, i) => (
        <IntakeFieldCard
          key={i}
          field={f}
          index={i}
          total={fields.length}
          duplicate={(nameCounts.get(f.name) ?? 0) > 1}
          onChange={(patch) => setField(i, patch)}
          onMove={(delta) => moveField(i, delta)}
          onRemove={() => removeField(i)}
        />
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...fields, emptyIntakeField()])}>
        <Plus className="me-1.5 size-3.5" /> {t.addIntakeField}
      </Button>
    </div>
  );
}
