import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CatalogAction, CatalogField, DiscordCatalog } from "@/lib/discord-bots-api";
import { newId } from "./ids";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface EditorEnv {
  catalog: DiscordCatalog;
  fa: boolean;
  actionByType: Record<string, CatalogAction>;
}

export function makeEnv(catalog: DiscordCatalog, fa: boolean): EditorEnv {
  return { catalog, fa, actionByType: Object.fromEntries(catalog.actions.map((a) => [a.type, a])) };
}

const CATEGORY_LABEL: Record<string, [string, string]> = {
  message: ["پیام‌ها", "Messages"],
  moderation: ["مدیریت سرور", "Moderation"],
  logic: ["منطق و متغیر", "Logic & variables"],
  data: ["داده و شبکه", "Data & network"],
  ticket: ["تیکت", "Tickets"],
};

const selectCls =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export const NativeSelect = ({ value, onChange, children, className }: { value: string; onChange: (v: string) => void; children: React.ReactNode; className?: string }) => (
  <select className={cn(selectCls, className)} value={value} onChange={(e) => onChange(e.target.value)}>
    {children}
  </select>
);

function defaultFor(f: CatalogField): any {
  if (["actions", "buttons", "selects", "modal_inputs", "embed_fields", "string_list"].includes(f.type)) return [];
  if (f.type === "condition") return {};
  if (f.default !== undefined) return f.default;
  return f.type === "boolean" ? false : "";
}

export function newAction(spec: CatalogAction): any {
  const a: any = { type: spec.type };
  for (const f of spec.fields) a[f.key] = defaultFor(f);
  return a;
}

// ─── conditions ──────────────────────────────────────────────────────────────
type Rule = { left: string; op: string; right: string };
interface Node { not: boolean; rule: Rule }
function condToNodes(c: any): { mode: "and" | "or"; nodes: Node[] } {
  if (!c || Object.keys(c).length === 0) return { mode: "and", nodes: [] };
  const toNode = (x: any): Node | null => {
    if (x?.not && x.not.op) return { not: true, rule: { left: x.not.left ?? "", op: x.not.op, right: x.not.right ?? "" } };
    if (x?.op) return { not: false, rule: { left: x.left ?? "", op: x.op, right: x.right ?? "" } };
    return null;
  };
  if (c.and || c.or) {
    const mode = c.or ? "or" : "and";
    return { mode, nodes: (c[mode] as any[]).map(toNode).filter(Boolean) as Node[] };
  }
  const n = toNode(c);
  return { mode: "and", nodes: n ? [n] : [] };
}
function nodesToCond(mode: "and" | "or", nodes: Node[]): any {
  const items = nodes.map((n) => (n.not ? { not: n.rule } : n.rule));
  if (items.length === 0) return {};
  if (items.length === 1 && !nodes[0].not) return items[0];
  return { [mode]: items };
}

export function ConditionEditor({ value, onChange, env }: { value: any; onChange: (v: any) => void; env: EditorEnv }) {
  const { mode, nodes } = condToNodes(value);
  const fa = env.fa;
  const set = (m: "and" | "or", n: Node[]) => onChange(nodesToCond(m, n));
  const noValue = (op: string) => op === "is_empty" || op === "not_empty";
  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      {nodes.length > 1 && (
        <div className="flex items-center gap-2 text-xs">
          <span>{fa ? "شرط‌ها با" : "Combine with"}</span>
          <NativeSelect className="h-8 w-auto" value={mode} onChange={(v) => set(v as "and" | "or", nodes)}>
            <option value="and">{fa ? "و (همه برقرار باشند)" : "AND (all)"}</option>
            <option value="or">{fa ? "یا (یکی کافی است)" : "OR (any)"}</option>
          </NativeSelect>
        </div>
      )}
      {nodes.length === 0 && <p className="text-xs text-muted-foreground">{fa ? "هنوز شرطی نیست." : "No conditions yet."}</p>}
      {nodes.map((n, i) => (
        <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr_auto_1fr_auto] sm:items-center">
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={n.not} onChange={(e) => set(mode, nodes.map((x, j) => (j === i ? { ...x, not: e.target.checked } : x)))} />
            {fa ? "نقیض" : "NOT"}
          </label>
          <Input dir="ltr" placeholder="{author.id}" value={n.rule.left} onChange={(e) => set(mode, nodes.map((x, j) => (j === i ? { ...x, rule: { ...x.rule, left: e.target.value } } : x)))} />
          <NativeSelect value={n.rule.op} onChange={(v) => set(mode, nodes.map((x, j) => (j === i ? { ...x, rule: { ...x.rule, op: v } } : x)))}>
            {env.catalog.operators.map((o) => <option key={o.id} value={o.id}>{fa ? o.label : o.labelEn}</option>)}
          </NativeSelect>
          <Input dir="ltr" disabled={noValue(n.rule.op)} placeholder={fa ? "مقدار" : "value"} value={n.rule.right} onChange={(e) => set(mode, nodes.map((x, j) => (j === i ? { ...x, rule: { ...x.rule, right: e.target.value } } : x)))} />
          <Button type="button" size="icon" variant="ghost" onClick={() => set(mode, nodes.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => set(mode, [...nodes, { not: false, rule: { left: "", op: "==", right: "" } }])}>
        <Plus className="me-1 size-3.5" />{fa ? "افزودن شرط" : "Add condition"}
      </Button>
    </div>
  );
}

// ─── single field ────────────────────────────────────────────────────────────
function FieldEditor({ spec, value, onChange, env, depth }: { spec: CatalogField; value: any; onChange: (v: any) => void; env: EditorEnv; depth: number }) {
  const fa = env.fa;
  const label = fa ? spec.label : spec.labelEn;
  const help = fa ? spec.help : spec.helpEn;
  const ltr = ["url", "user", "role", "channel", "ident", "color"].includes(spec.type) || spec.supportsVariables;

  let body: React.ReactNode;
  switch (spec.type) {
    case "textarea":
      body = <Textarea rows={3} maxLength={spec.max} dir={ltr ? "auto" : undefined} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "boolean":
      body = <Switch checked={!!value} onCheckedChange={onChange} />;
      break;
    case "select":
      body = (
        <NativeSelect value={String(value ?? "")} onChange={onChange}>
          {(spec.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </NativeSelect>
      );
      break;
    case "color":
      body = (
        <div className="flex items-center gap-2">
          <input type="color" className="h-9 w-12 cursor-pointer rounded border bg-transparent" value={/^#[0-9a-fA-F]{6}$/.test(value ?? "") ? value : "#5865F2"} onChange={(e) => onChange(e.target.value)} />
          <Input dir="ltr" className="max-w-40" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
      break;
    case "string_list":
      body = (
        <Textarea rows={4} placeholder={fa ? "هر گزینه در یک خط" : "One option per line"} value={(value ?? []).join("\n")} onChange={(e) => onChange(e.target.value.split("\n"))} />
      );
      break;
    case "condition":
      body = <ConditionEditor value={value} onChange={onChange} env={env} />;
      break;
    case "actions":
      body = <ActionListEditor value={value ?? []} onChange={onChange} env={env} depth={depth + 1} compact />;
      break;
    case "embed_fields":
      body = <EmbedFieldsEditor value={value ?? []} onChange={onChange} fa={fa} max={env.catalog.limits.maxEmbedFields} />;
      break;
    case "buttons":
      body = <ButtonsEditor value={value ?? []} onChange={onChange} env={env} depth={depth} />;
      break;
    case "selects":
      body = <SelectsEditor value={value ?? []} onChange={onChange} env={env} depth={depth} />;
      break;
    case "modal_inputs":
      body = <ModalInputsEditor value={value ?? []} onChange={onChange} env={env} />;
      break;
    default:
      body = (
        <Input
          dir={ltr ? "ltr" : undefined}
          maxLength={spec.max && spec.type === "text" ? spec.max : undefined}
          placeholder={spec.placeholder}
          inputMode={spec.type === "number" ? "text" : undefined}
          value={value ?? ""}
          onChange={(e) => onChange(spec.type === "number" && /^-?\d+(\.\d+)?$/.test(e.target.value) ? Number(e.target.value) : e.target.value)}
        />
      );
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <span>{label}</span>
        {spec.required && <span className="text-destructive">*</span>}
      </div>
      {body}
      {help && <p className="text-[11px] leading-relaxed text-muted-foreground">{help}</p>}
    </div>
  );
}

function EmbedFieldsEditor({ value, onChange, fa, max }: { value: any[]; onChange: (v: any[]) => void; fa: boolean; max: number }) {
  return (
    <div className="space-y-2">
      {value.map((f, i) => (
        <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_1.5fr_auto_auto] sm:items-center">
          <Input placeholder={fa ? "نام" : "Name"} value={f.name ?? ""} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <Input placeholder={fa ? "مقدار" : "Value"} value={f.value ?? ""} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
          <label className="flex items-center gap-1 text-xs"><Switch checked={f.inline !== false} onCheckedChange={(c) => onChange(value.map((x, j) => (j === i ? { ...x, inline: c } : x)))} />{fa ? "کنار هم" : "Inline"}</label>
          <Button type="button" size="icon" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
        </div>
      ))}
      {value.length < max && (
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...value, { name: "", value: "", inline: true }])}><Plus className="me-1 size-3.5" />{fa ? "افزودن فیلد" : "Add field"}</Button>
      )}
    </div>
  );
}

function ButtonsEditor({ value, onChange, env, depth }: { value: any[]; onChange: (v: any[]) => void; env: EditorEnv; depth: number }) {
  const fa = env.fa;
  const max = env.catalog.limits.maxButtonsPerAction;
  const upd = (i: number, patch: any) => onChange(value.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  return (
    <div className="space-y-2">
      {value.map((b, i) => (
        <div key={b.id ?? i} className="space-y-2 rounded-md border bg-muted/30 p-3">
          <div className="grid gap-2 sm:grid-cols-[1.5fr_1fr_1fr_auto] sm:items-center">
            <Input placeholder={fa ? "متن دکمه" : "Label"} value={b.label ?? ""} onChange={(e) => upd(i, { label: e.target.value })} />
            <NativeSelect value={b.style ?? "primary"} onChange={(v) => upd(i, v === "link" ? { style: v, actions: undefined } : { style: v, id: b.id ?? newId(), actions: b.actions ?? [] })}>
              {env.catalog.buttonStyles.map((s) => <option key={s} value={s}>{s}</option>)}
            </NativeSelect>
            <Input dir="ltr" placeholder={fa ? "ایموجی (اختیاری)" : "Emoji (optional)"} value={b.emoji ?? ""} onChange={(e) => upd(i, { emoji: e.target.value })} />
            <Button type="button" size="icon" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
          </div>
          {b.style === "link" ? (
            <Input dir="ltr" placeholder="https://…" value={b.url ?? ""} onChange={(e) => upd(i, { url: e.target.value })} />
          ) : (
            <div className="space-y-1">
              <p className="text-xs font-medium">{fa ? "با کلیک روی دکمه این اکشن‌ها اجرا شود:" : "When clicked, run:"}</p>
              <ActionListEditor value={b.actions ?? []} onChange={(a) => upd(i, { actions: a })} env={env} depth={depth + 2} compact />
            </div>
          )}
        </div>
      ))}
      {value.length < max && (
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...value, { id: newId(), label: "", style: "primary", emoji: "", actions: [] }])}>
          <Plus className="me-1 size-3.5" />{fa ? "افزودن دکمه" : "Add button"}
        </Button>
      )}
    </div>
  );
}

function SelectsEditor({ value, onChange, env, depth }: { value: any[]; onChange: (v: any[]) => void; env: EditorEnv; depth: number }) {
  const fa = env.fa;
  const max = env.catalog.limits.maxSelectsPerAction;
  const maxOpts = env.catalog.limits.maxSelectOptions;
  const upd = (i: number, patch: any) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const updOpt = (i: number, n: number, patch: any) => upd(i, { options: value[i].options.map((o: any, k: number) => (k === n ? { ...o, ...patch } : o)) });
  return (
    <div className="space-y-2">
      {value.map((sel, i) => (
        <div key={sel.id ?? i} className="space-y-2 rounded-md border bg-muted/30 p-3">
          <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-center">
            <Input placeholder={fa ? "متن راهنمای منو (مثلاً یک گزینه انتخاب کنید)" : "Placeholder (e.g. Pick one)"} maxLength={150} value={sel.placeholder ?? ""} onChange={(e) => upd(i, { placeholder: e.target.value })} />
            <Input dir="ltr" inputMode="numeric" title={fa ? "حداقل انتخاب" : "Min choices"} placeholder="min" value={sel.min_values ?? 1} onChange={(e) => upd(i, { min_values: Number(e.target.value) || 0 })} />
            <Input dir="ltr" inputMode="numeric" title={fa ? "حداکثر انتخاب" : "Max choices"} placeholder="max" value={sel.max_values ?? 1} onChange={(e) => upd(i, { max_values: Number(e.target.value) || 1 })} />
            <Button type="button" size="icon" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
          </div>
          <div className="space-y-1.5">
            {(sel.options ?? []).map((o: any, n: number) => (
              <div key={n} className="grid gap-2 sm:grid-cols-[1.2fr_1fr_1.4fr_auto] sm:items-center">
                <Input placeholder={fa ? "متن گزینه" : "Option label"} maxLength={100} value={o.label ?? ""} onChange={(e) => updOpt(i, n, { label: e.target.value })} />
                <Input dir="ltr" placeholder={fa ? "مقدار (خالی = همان متن)" : "Value (empty = label)"} maxLength={100} value={o.value ?? ""} onChange={(e) => updOpt(i, n, { value: e.target.value })} />
                <Input placeholder={fa ? "توضیح (اختیاری)" : "Description (optional)"} maxLength={100} value={o.description ?? ""} onChange={(e) => updOpt(i, n, { description: e.target.value })} />
                <Button type="button" size="icon" variant="ghost" onClick={() => upd(i, { options: sel.options.filter((_: any, k: number) => k !== n) })}><Trash2 className="size-4" /></Button>
              </div>
            ))}
            {(sel.options ?? []).length < maxOpts && (
              <Button type="button" size="sm" variant="outline" onClick={() => upd(i, { options: [...(sel.options ?? []), { label: "", value: "", description: "", emoji: "" }] })}>
                <Plus className="me-1 size-3.5" />{fa ? "افزودن گزینه" : "Add option"}
              </Button>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium">{fa ? "وقتی کاربر انتخاب کرد اجرا شود ({select.value} / {select.values}):" : "When a user chooses, run ({select.value} / {select.values}):"}</p>
            <ActionListEditor value={sel.actions ?? []} onChange={(a) => upd(i, { actions: a })} env={env} depth={depth + 2} compact />
          </div>
        </div>
      ))}
      {value.length < max && (
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...value, { id: newId(), placeholder: "", min_values: 1, max_values: 1, options: [{ label: "", value: "", description: "", emoji: "" }], actions: [] }])}>
          <Plus className="me-1 size-3.5" />{fa ? "افزودن منوی انتخاب" : "Add select menu"}
        </Button>
      )}
    </div>
  );
}

function ModalInputsEditor({ value, onChange, env }: { value: any[]; onChange: (v: any[]) => void; env: EditorEnv }) {
  const fa = env.fa;
  const max = env.catalog.limits.maxModalInputs;
  const upd = (i: number, patch: any) => onChange(value.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="space-y-2">
      {value.map((f, i) => (
        <div key={i} className="space-y-2 rounded-md border p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_1fr_auto] sm:items-center">
            <Input dir="ltr" placeholder={fa ? "شناسه (مثل name)" : "id (e.g. name)"} maxLength={32} value={f.id ?? ""} onChange={(e) => upd(i, { id: e.target.value.replace(/[^A-Za-z0-9_]/g, "") })} />
            <Input placeholder={fa ? "عنوان فیلد" : "Field label"} maxLength={45} value={f.label ?? ""} onChange={(e) => upd(i, { label: e.target.value })} />
            <NativeSelect value={f.style ?? "short"} onChange={(v) => upd(i, { style: v })}>
              {env.catalog.inputStyles.map((s) => <option key={s} value={s}>{s === "short" ? (fa ? "تک‌خطی" : "short") : (fa ? "چندخطی" : "paragraph")}</option>)}
            </NativeSelect>
            <Button type="button" size="icon" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1.6fr_auto_1fr_1fr] sm:items-center">
            <Input placeholder={fa ? "متن راهنما (اختیاری)" : "Placeholder (optional)"} maxLength={100} value={f.placeholder ?? ""} onChange={(e) => upd(i, { placeholder: e.target.value })} />
            <label className="flex items-center gap-1 text-xs"><Switch checked={f.required !== false} onCheckedChange={(c) => upd(i, { required: c })} />{fa ? "اجباری" : "Required"}</label>
            <Input dir="ltr" inputMode="numeric" title={fa ? "حداقل طول" : "Min length"} placeholder="min" value={f.min_length ?? 0} onChange={(e) => upd(i, { min_length: Number(e.target.value) || 0 })} />
            <Input dir="ltr" inputMode="numeric" title={fa ? "حداکثر طول" : "Max length"} placeholder="max" value={f.max_length ?? 400} onChange={(e) => upd(i, { max_length: Number(e.target.value) || 1 })} />
          </div>
          <p className="text-[11px] text-muted-foreground" dir="ltr">{`{modal.${f.id || "id"}}`}</p>
        </div>
      ))}
      {value.length < max && (
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...value, { id: "", label: "", style: "short", placeholder: "", required: true, min_length: 0, max_length: 400 }])}>
          <Plus className="me-1 size-3.5" />{fa ? "افزودن فیلد" : "Add input"}
        </Button>
      )}
    </div>
  );
}

// ─── action list ─────────────────────────────────────────────────────────────
function ActionCard({ action, index, total, onChange, onMove, onRemove, onDuplicate, env, depth }: {
  action: any; index: number; total: number; onChange: (a: any) => void; onMove: (d: -1 | 1) => void; onRemove: () => void; onDuplicate: () => void; env: EditorEnv; depth: number;
}) {
  const spec = env.actionByType[action.type];
  const [open, setOpen] = useState(true);
  const fa = env.fa;
  if (!spec) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-destructive/50 p-3 text-sm">
        <span>{fa ? "اکشن ناشناخته" : "Unknown action"}: {String(action.type)}</span>
        <Button type="button" size="icon" variant="ghost" onClick={onRemove}><Trash2 className="size-4" /></Button>
      </div>
    );
  }
  const summary = String(action.content ?? action.title ?? action.name ?? action.key ?? action.url ?? "").slice(0, 60);
  return (
    <div className={cn("rounded-lg border bg-card shadow-sm", depth > 1 && "bg-background")}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="flex size-6 items-center justify-center rounded bg-primary/10 text-xs font-bold text-primary">{index + 1}</span>
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-start" onClick={() => setOpen(!open)}>
          <span className="truncate text-sm font-semibold">{fa ? spec.label : spec.labelEn}</span>
          {!open && summary && <span className="truncate text-xs text-muted-foreground" dir="auto">{summary}</span>}
        </button>
        {spec.botPermissions.length > 0 && <Badge variant="outline" className="hidden text-[10px] sm:inline-flex">{spec.botPermissions[0]}</Badge>}
        <Button type="button" size="icon" variant="ghost" className="size-7" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp className="size-3.5" /></Button>
        <Button type="button" size="icon" variant="ghost" className="size-7" disabled={index === total - 1} onClick={() => onMove(1)}><ArrowDown className="size-3.5" /></Button>
        <Button type="button" size="icon" variant="ghost" className="size-7" onClick={onDuplicate}><Copy className="size-3.5" /></Button>
        <Button type="button" size="icon" variant="ghost" className="size-7 text-destructive" onClick={onRemove}><Trash2 className="size-3.5" /></Button>
        <button type="button" onClick={() => setOpen(!open)} className="text-muted-foreground">{open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</button>
      </div>
      {open && spec.fields.length > 0 && (
        <div className="grid gap-3 p-3">
          {spec.fields.map((f) => (
            <FieldEditor key={f.key} spec={f} value={action[f.key]} onChange={(v) => onChange({ ...action, [f.key]: v })} env={env} depth={depth} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ActionListEditor({ value, onChange, env, depth = 1, compact = false }: {
  value: any[]; onChange: (v: any[]) => void; env: EditorEnv; depth?: number; compact?: boolean;
}) {
  const fa = env.fa;
  const [pick, setPick] = useState("");
  const grouped = useMemo(() => {
    const g: Record<string, CatalogAction[]> = {};
    for (const a of env.catalog.actions) (g[a.category] ??= []).push(a);
    return g;
  }, [env.catalog]);
  const maxDepth = env.catalog.limits.maxDepth;
  const canAdd = value.length < env.catalog.limits.maxActionsPerList;
  const add = () => {
    const spec = env.actionByType[pick];
    if (!spec) return;
    onChange([...value, newAction(spec)]);
    setPick("");
  };
  return (
    <div className={cn("space-y-2", compact && "ps-2 border-s-2 border-primary/20")}>
      {value.length === 0 && <p className="text-xs text-muted-foreground">{fa ? "هنوز اکشنی اضافه نشده." : "No actions yet."}</p>}
      {value.map((a, i) => (
        <ActionCard
          key={i} action={a} index={i} total={value.length} env={env} depth={depth}
          onChange={(na) => onChange(value.map((x, j) => (j === i ? na : x)))}
          onRemove={() => onChange(value.filter((_, j) => j !== i))}
          onMove={(d) => { const n = [...value]; [n[i], n[i + d]] = [n[i + d], n[i]]; onChange(n); }}
          onDuplicate={() => {
            const copy = JSON.parse(JSON.stringify(a));
            for (const b of copy.buttons ?? []) if (b.id) b.id = newId();
            for (const sel of copy.selects ?? []) sel.id = newId();
            if (copy.type === "show_modal") copy.id = newId();
            onChange([...value.slice(0, i + 1), copy, ...value.slice(i + 1)]);
          }}
        />
      ))}
      {canAdd && depth <= maxDepth && (
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect className="w-auto min-w-48" value={pick} onChange={setPick}>
            <option value="">{fa ? "افزودن اکشن…" : "Add action…"}</option>
            {Object.entries(grouped).map(([cat, items]) => (
              <optgroup key={cat} label={fa ? CATEGORY_LABEL[cat]?.[0] : CATEGORY_LABEL[cat]?.[1]}>
                {items.map((a) => <option key={a.type} value={a.type}>{fa ? a.label : a.labelEn}</option>)}
              </optgroup>
            ))}
          </NativeSelect>
          <Button type="button" size="sm" disabled={!pick} onClick={add}><Plus className="me-1 size-3.5" />{fa ? "افزودن" : "Add"}</Button>
        </div>
      )}
    </div>
  );
}
