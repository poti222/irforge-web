/**
 * ObjectsSection.tsx — آبجکت‌های دینامیک (فاز ۱۸).
 * لیست آبجکت‌ها → ویرایشگر schema → جدول رکوردها با CRUD ردیفی.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { Loader2, Plus, Trash2, ArrowRight, Boxes, Save, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";

type ObjectField = {
  id: string;
  name: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
  relation_object_id: string;
  order: number;
};

type ObjectSchema = {
  id: string;
  name: string;
  slug: string;
  icon: string;
  color: string;
  fields: ObjectField[];
  is_active: boolean;
  recordCount?: number;
};

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}

function RecordsTable({ botId, schema }: { botId: string; schema: ObjectSchema }) {
  const t = useT("botAdvanced");
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["bot-object-records", botId, schema.id] as const;

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () =>
      customFetch<{ records: Array<Record<string, any>>; total: number }>(
        `/api/bots/${botId}/objects/${schema.id}/records?limit=100`
      ),
  });

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [addOpen, setAddOpen] = useState(false);

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch(`/api/bots/${botId}/objects/${schema.id}/records`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setAddOpen(false); setDraft({}); toast({ title: t.recordCreated }); },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });
  const remove = useMutation({
    mutationFn: (recordId: string) =>
      customFetch(`/api/bots/${botId}/objects/${schema.id}/records/${recordId}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast({ title: t.recordDeleted }); },
  });

  if (isLoading) return <Loader2 className="size-4 animate-spin text-muted-foreground" />;

  const fields = schema.fields ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t.recordCount.replace("{n}", String(data?.total ?? 0))}</p>
        <Button size="sm" disabled={fields.length === 0} onClick={() => setAddOpen(true)}>
          <Plus className="me-1.5 size-4" /> {t.addRecord}
        </Button>
      </div>

      {fields.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{t.defineFieldsFirst}</p>
      ) : (data?.records.length ?? 0) === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{t.noRecords}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[30rem] text-sm">
            <thead className="bg-muted/50">
              <tr>
                {fields.map((f) => <th key={f.id} className="p-2 text-start font-medium">{f.label || f.name}</th>)}
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {data!.records.map((record) => (
                <tr key={record._id} className="border-t">
                  {fields.map((f) => (
                    <td key={f.id} className="max-w-48 truncate p-2">{String(record[f.name] ?? "—")}</td>
                  ))}
                  <td className="p-2 text-end">
                    <Button
                      variant="ghost" size="icon" aria-label={t.deleteRecord}
                      onClick={() => remove.mutate(record._id)} disabled={remove.isPending}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t.addRecord}</DialogTitle>
            <DialogDescription>{schema.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {fields.map((f) => (
              <div key={f.id} className="space-y-1.5">
                <Label htmlFor={`rec-${f.id}`}>
                  {f.label || f.name}{f.required && <span className="text-destructive"> *</span>}
                </Label>
                {f.type === "select" ? (
                  <Select value={draft[f.name] ?? ""} onValueChange={(v) => setDraft((p) => ({ ...p, [f.name]: v }))}>
                    <SelectTrigger id={`rec-${f.id}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {f.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={`rec-${f.id}`}
                    type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                    value={draft[f.name] ?? ""}
                    onChange={(e) => setDraft((p) => ({ ...p, [f.name]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => create.mutate(draft)} disabled={create.isPending}>
              {create.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SchemaEditor({ botId, schema, onBack }: { botId: string; schema: ObjectSchema; onBack: () => void }) {
  const t = useT("botAdvanced");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"fields" | "records">("fields");
  const [fields, setFields] = useState<ObjectField[]>(schema.fields ?? []);

  const save = useMutation({
    mutationFn: () =>
      customFetch(`/api/bots/${botId}/objects/${schema.id}`, {
        method: "PATCH",
        body: JSON.stringify({ fields }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bot-objects", botId] }); toast({ title: t.schemaSaved }); },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const dirty = JSON.stringify(fields) !== JSON.stringify(schema.fields ?? []);

  function setField(i: number, patch: Partial<ObjectField>) {
    setFields((prev) => prev.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  }
  function move(i: number, delta: -1 | 1) {
    const target = i + delta;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[i], next[target]] = [next[target], next[i]];
    setFields(next.map((f, k) => ({ ...f, order: k })));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowRight className="me-1.5 size-4 rtl-flip" /> {t.backToList}
        </Button>
        <h3 className="min-w-0 flex-1 truncate text-lg font-semibold">{schema.icon} {schema.name}</h3>
        <Badge variant="outline" dir="ltr">{schema.slug}</Badge>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "fields" | "records")}>
        <TabsList>
          <TabsTrigger value="fields">{t.tabFields}</TabsTrigger>
          <TabsTrigger value="records">{t.tabRecords}</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "fields" ? (
        <div className="space-y-3">
          {fields.map((field, i) => (
            <div key={field.id} className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`of-name-${i}`}>{t.fieldName}</Label>
                <Input id={`of-name-${i}`} dir="ltr" value={field.name} onChange={(e) => setField(i, { name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`of-label-${i}`}>{t.fieldLabel}</Label>
                <Input id={`of-label-${i}`} value={field.label} onChange={(e) => setField(i, { label: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`of-type-${i}`}>{t.fieldType}</Label>
                <Select value={field.type} onValueChange={(v) => setField(i, { type: v })}>
                  <SelectTrigger id={`of-type-${i}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["text", "number", "boolean", "date", "select", "relation", "textarea", "url", "email"].map((x) => (
                      <SelectItem key={x} value={x}>{x}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end justify-between gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={field.required} onCheckedChange={(v) => setField(i, { required: v })} />
                  {t.fieldRequired}
                </label>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" aria-label={t.moveUp} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={t.moveDown} disabled={i === fields.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={t.removeField} onClick={() => setFields(fields.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </div>
              {field.type === "select" && (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`of-opt-${i}`}>{t.fieldOptions}</Label>
                  <Input
                    id={`of-opt-${i}`}
                    value={field.options.join(", ")}
                    onChange={(e) => setField(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                  />
                </div>
              )}
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                setFields([
                  ...fields,
                  { id: `f${Date.now()}`, name: "", label: "", type: "text", required: false, options: [], relation_object_id: "", order: fields.length },
                ])
              }
            >
              <Plus className="me-1.5 size-4" /> {t.addField}
            </Button>
            <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
              {save.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <Save className="me-2 size-4" />}
              {t.save}
            </Button>
          </div>
        </div>
      ) : (
        <RecordsTable botId={botId} schema={{ ...schema, fields }} />
      )}
    </div>
  );
}

export function ObjectsSection({ bot }: { bot: Bot }) {
  const t = useT("botAdvanced");
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["bot-objects", bot.id] as const;

  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => customFetch<{ objects: ObjectSchema[] }>(`/api/bots/${bot.id}/objects`),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => customFetch<{ object: ObjectSchema }>(`/api/bots/${bot.id}/objects`, {
      method: "POST",
      body: JSON.stringify({ name, slug, fields: [] }),
    }),
    onSuccess: ({ object }) => {
      qc.invalidateQueries({ queryKey: key });
      setCreateOpen(false); setName(""); setSlug("");
      setSelectedId(object.id);
      toast({ title: t.objectCreated });
    },
    onError: (err: any) => setCreateError(errMessage(err, t.errorGeneric)),
  });

  const remove = useMutation({
    mutationFn: (objectId: string) => customFetch(`/api/bots/${bot.id}/objects/${objectId}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast({ title: t.objectDeleted }); },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  if (isLoading) return <div className="flex items-center gap-2 p-8 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;
  if (error || !data) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {errCode(error) === "no_sheet" ? t.noSheetYet : errMessage(error, t.errorGeneric)}
      </div>
    );
  }

  const selected = data.objects.find((o) => o.id === selectedId) ?? null;
  if (selected) return <SchemaEditor botId={bot.id} schema={selected} onBack={() => setSelectedId(null)} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="w-full text-sm text-muted-foreground sm:w-auto sm:min-w-0 sm:flex-1">{t.objectsDesc}</p>
        <Button onClick={() => { setCreateError(null); setCreateOpen(true); }}>
          <Plus className="me-1.5 size-4" /> {t.newObject}
        </Button>
      </div>

      {data.objects.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{t.noObjects}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.objects.map((object) => (
            <Card key={object.id}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span>{object.icon || "📦"}</span>
                  <span className="min-w-0 flex-1 truncate">{object.name}</span>
                  {!object.is_active && <Badge variant="secondary">{t.inactive}</Badge>}
                </CardTitle>
                <CardDescription dir="ltr">{object.slug}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline">{t.fieldCount.replace("{n}", String(object.fields?.length ?? 0))}</Badge>
                <Badge variant="outline">{t.recordCount.replace("{n}", String(object.recordCount ?? 0))}</Badge>
                <Button variant="outline" size="sm" className="ms-auto" onClick={() => setSelectedId(object.id)}>
                  <Boxes className="me-1.5 size-4" /> {t.manage}
                </Button>
                <Button
                  variant="ghost" size="icon" aria-label={t.deleteObject}
                  onClick={() => {
                    // حذفِ آبجکتی که رکورد دارد باید عدد را صریح بگوید.
                    const count = object.recordCount ?? 0;
                    if (count > 0 && !window.confirm(t.confirmDeleteWithRecords.replace("{n}", String(count)))) return;
                    remove.mutate(object.id);
                  }}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.newObject}</DialogTitle>
            <DialogDescription>{t.newObjectDesc}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="obj-name">{t.objectName}</Label>
              <Input
                id="obj-name" value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  // slug پیشنهادی از روی نام — کاربر می‌تواند عوضش کند، ولی بعد
                  // از ساخت دیگر قابل تغییر نیست (نام تب رکوردها از آن می‌آید).
                  if (!slug) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""));
                  setCreateError(null);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="obj-slug">{t.objectSlug}</Label>
              <Input id="obj-slug" dir="ltr" value={slug} onChange={(e) => { setSlug(e.target.value); setCreateError(null); }} />
              <p className="text-xs text-muted-foreground">{t.objectSlugHint}</p>
            </div>
            {createError && <p className="text-sm text-destructive">{createError}</p>}
          </div>
          <DialogFooter>
            <Button onClick={() => create.mutate()} disabled={!name.trim() || !slug.trim() || create.isPending}>
              {create.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
