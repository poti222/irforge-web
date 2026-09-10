/**
 * guidedFlow/ConditionBuilder.tsx — IRFORGE_GUIDED_FLOW_INVITE_CARD_PROMPT
 * فازِ B1.
 *
 * سازنده‌ی شرط برایِ یک transition: «اگر جوابِ گامِ X [عملگر] Y بود» + یک
 * AND/OR مشترک بینِ چند شرط. هیچ نمونه‌ی قبلی‌ای برای یک condition-tree
 * builder در این کدبیس پیدا نشد (بررسی شد: `WorkflowsSection.tsx` فقط یک
 * لیستِ تختِ implicit-AND دارد، بدونِ حتی همین سوییچِ AND/OR) — این اولین
 * است.
 *
 * عمداً یک‌سطحی، نه یک درختِ تودرتویِ بازگشتی: پرامپت این را صریح «یک UIِ
 * ساده» خواسته، نه ادیتورِ گروه‌درون‌گروه. `utils/workflow_engine.py` سمتِ
 * بات از قبل از تودرتوییِ کامل پشتیبانی می‌کند، پس اگر یک پرامپتِ بعدی
 * nested groups خواست، این فقط لایه‌ی UI را عمیق‌تر می‌کند، نه evaluator را.
 *
 * سریالایز:
 *   ۰ شرط  → {}                              («همیشه بگیر»)
 *   ۱ شرط  → همان leaf، بدونِ wrap در گروه
 *   ۲+ شرط → {logic: "and"|"or", conditions: [...]}
 */
import { useT } from "@/hooks/use-translation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Trash2, Plus } from "lucide-react";
import type { ConditionLeaf, FlowCondition } from "./api";
import { isConditionGroup } from "./api";

export type FieldOption = { id: string; label: string };

const OPERATORS = [
  "eq", "neq", "in", "not_in", "contains", "not_contains",
  "gt", "gte", "lt", "lte", "is_empty", "is_not_empty",
] as const;

function toLeaves(condition: FlowCondition): ConditionLeaf[] {
  if (!condition || Object.keys(condition).length === 0) return [];
  if (isConditionGroup(condition)) return condition.conditions.filter((c): c is ConditionLeaf => !isConditionGroup(c) && Object.keys(c).length > 0);
  return [condition as ConditionLeaf];
}

function toLogic(condition: FlowCondition): "and" | "or" {
  return isConditionGroup(condition) ? condition.logic : "and";
}

function serialize(leaves: ConditionLeaf[], logic: "and" | "or"): FlowCondition {
  if (leaves.length === 0) return {};
  if (leaves.length === 1) return leaves[0];
  return { logic, conditions: leaves };
}

export function ConditionBuilder({
  value, onChange, fieldOptions,
}: {
  value: FlowCondition;
  onChange: (next: FlowCondition) => void;
  fieldOptions: FieldOption[];
}) {
  const t = useT("guidedFlow");
  const leaves = toLeaves(value);
  const logic = toLogic(value);

  const updateLeaf = (index: number, patch: Partial<ConditionLeaf>) => {
    const next = leaves.map((l, i) => (i === index ? { ...l, ...patch } : l));
    onChange(serialize(next, logic));
  };
  const removeLeaf = (index: number) => {
    onChange(serialize(leaves.filter((_, i) => i !== index), logic));
  };
  const addLeaf = () => {
    const defaultField = fieldOptions[0]?.id ?? "";
    onChange(serialize([...leaves, { field: defaultField, operator: "eq", value: "" }], logic));
  };
  const setLogic = (next: "and" | "or") => {
    onChange(serialize(leaves, next));
  };

  if (leaves.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        <p>{t.conditionAlwaysMatches}</p>
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={addLeaf}>
          <Plus className="me-1 size-3.5" /> {t.addCondition}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      {leaves.length > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t.conditionLogicLabel}</span>
          <Select value={logic} onValueChange={(v) => setLogic(v as "and" | "or")}>
            <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="and">{t.logicAnd}</SelectItem>
              <SelectItem value="or">{t.logicOr}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {leaves.map((leaf, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <Select value={leaf.field} onValueChange={(v) => updateLeaf(index, { field: v })}>
            <SelectTrigger className="h-8 w-40"><SelectValue placeholder={t.conditionFieldPlaceholder} /></SelectTrigger>
            <SelectContent>
              {fieldOptions.map((f) => (
                <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={leaf.operator} onValueChange={(v) => updateLeaf(index, { operator: v })}>
            <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {OPERATORS.map((op) => (
                <SelectItem key={op} value={op}>{t.operators?.[op] ?? op}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {leaf.operator !== "is_empty" && leaf.operator !== "is_not_empty" && (
            <Input
              className="h-8 w-32"
              value={leaf.value ?? ""}
              placeholder={t.conditionValuePlaceholder}
              onChange={(e) => updateLeaf(index, { value: e.target.value })}
            />
          )}

          <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => removeLeaf(index)}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={addLeaf}>
        <Plus className="me-1 size-3.5" /> {t.addCondition}
      </Button>
    </div>
  );
}
