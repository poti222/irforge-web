/**
 * PluginCollectionTable.tsx — جدول عمومیِ داده‌ی یک پلاگین.
 *
 * فرم و جدول از **اسکیمایی که سرور می‌دهد** ساخته می‌شوند
 * (`lib/pluginCollections.ts`)، نه از یک فرم دستی به‌ازای هر پلاگین. یعنی
 * اضافه‌شدن یک فیلد در بات، فقط یک خط در آن اسکیما است و همین جدول خودش
 * نشانش می‌دهد — هفده کپیِ همین کامپوننت لازم نیست.
 *
 * فیلدهای `readonly` نمایش داده می‌شوند ولی در فرم ورودی نمی‌آیند: شمارنده‌هایی
 * مثل `booked_count` را خودِ بات نگه می‌دارد و نوشتن دستی‌شان عدد را خراب
 * می‌کند.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Loader2, Pencil, Plus, Trash2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";

export type FieldSpec = {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "boolean" | "select" | "datetime" | "readonly";
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  maxLength?: number;
  default?: string | number | boolean;
  help?: string;
};

export type CollectionSpec = {
  key: string;
  tab: string;
  plugin: string;
  titleFa: string;
  descriptionFa?: string;
  idPrefix: string;
  fields: FieldSpec[];
  listColumns: string[];
  sortBy?: string;
  readonly?: boolean;
  noCreate?: boolean;
};

type Record_ = Record<string, unknown> & { id: string };

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}

/** ISO → مقداری که `<input type="datetime-local">` می‌پذیرد (بدون ثانیه/زون). */
function isoToLocalInput(value: unknown): string {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** نمایش یک سلول — خواندنی برای انسان، نه JSON خام. */
function renderCell(field: FieldSpec | undefined, value: unknown, locale: string): React.ReactNode {
  if (value === undefined || value === null || value === "") return <span className="text-muted-foreground">—</span>;

  if (field?.type === "boolean" || typeof value === "boolean") {
    return value ? <Badge variant="secondary">✓</Badge> : <span className="text-muted-foreground">—</span>;
  }
  if (field?.type === "select") {
    const label = field.options?.find((o) => o.value === String(value))?.label;
    return label ? <Badge variant="outline">{label}</Badge> : String(value);
  }
  if (field?.type === "datetime" || /_at$/.test(field?.key ?? "")) {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) {
      return (
        <span className="whitespace-nowrap tabular-nums" dir="ltr">
          {date.toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })}
        </span>
      );
    }
  }
  if (typeof value === "number") {
    return <span className="tabular-nums">{value.toLocaleString(locale)}</span>;
  }
  if (typeof value === "object") {
    // آبجکت/آرایه (مثل `questions` یا `answers`) — شمارش، نه دامپ JSON.
    const count = Array.isArray(value) ? value.length : Object.keys(value).length;
    return <span className="text-muted-foreground">{count.toLocaleString(locale)} مورد</span>;
  }

  const text = String(value);
  return text.length > 60 ? <span title={text}>{text.slice(0, 59)}…</span> : text;
}

function RecordForm({
  spec, initial, onChange,
}: {
  spec: CollectionSpec;
  initial: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const editable = spec.fields.filter((f) => f.type !== "readonly");

  function set(key: string, value: unknown) {
    onChange({ ...initial, [key]: value });
  }

  return (
    <div className="grid gap-4 py-2">
      {editable.map((field) => {
        const value = initial[field.key];
        const id = `pf-${spec.key}-${field.key}`;
        return (
          <div key={field.key} className="grid gap-1.5">
            <Label htmlFor={id}>
              {field.label}
              {field.required && <span className="text-destructive"> *</span>}
            </Label>

            {field.type === "textarea" && (
              <Textarea
                id={id}
                value={String(value ?? "")}
                maxLength={field.maxLength}
                rows={4}
                onChange={(e) => set(field.key, e.target.value)}
              />
            )}

            {field.type === "text" && (
              <Input
                id={id}
                value={String(value ?? "")}
                maxLength={field.maxLength}
                onChange={(e) => set(field.key, e.target.value)}
              />
            )}

            {field.type === "number" && (
              <Input
                id={id}
                type="number"
                inputMode="numeric"
                value={value === undefined || value === null ? "" : String(value)}
                min={field.min}
                max={field.max}
                onChange={(e) => set(field.key, e.target.value === "" ? "" : Number(e.target.value))}
              />
            )}

            {field.type === "datetime" && (
              <Input
                id={id}
                type="datetime-local"
                dir="ltr"
                value={isoToLocalInput(value)}
                onChange={(e) =>
                  // رشته‌ی خالی یعنی «پاکش کن»، نه «Invalid Date».
                  set(field.key, e.target.value ? new Date(e.target.value).toISOString() : "")
                }
              />
            )}

            {field.type === "boolean" && (
              <div className="flex items-center gap-2">
                <Switch
                  id={id}
                  checked={Boolean(value)}
                  onCheckedChange={(checked) => set(field.key, checked)}
                />
              </div>
            )}

            {field.type === "select" && (
              <Select value={String(value ?? "")} onValueChange={(next) => set(field.key, next)}>
                <SelectTrigger id={id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(field.options ?? []).map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
          </div>
        );
      })}
    </div>
  );
}

export function PluginCollectionTable({ botId, collection }: { botId: string; collection: string }) {
  const t = useT("botPluginData");
  const { toast } = useToast();
  const qc = useQueryClient();

  const queryKey = ["bot-plugin-data", botId, collection] as const;
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () =>
      customFetch<{ spec: CollectionSpec; records: Record_[] }>(
        `/api/bots/${botId}/plugin-data/${collection}`,
      ),
  });

  const [editing, setEditing] = useState<Record_ | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [deleteTarget, setDeleteTarget] = useState<Record_ | null>(null);

  const spec = data?.spec;
  const fieldsByKey = useMemo(
    () => new Map((spec?.fields ?? []).map((f) => [f.key, f])),
    [spec],
  );

  function invalidate() {
    qc.invalidateQueries({ queryKey });
  }

  const save = useMutation({
    mutationFn: () => {
      if (editing) {
        return customFetch(`/api/bots/${botId}/plugin-data/${collection}/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(draft),
        });
      }
      return customFetch(`/api/bots/${botId}/plugin-data/${collection}`, {
        method: "POST",
        body: JSON.stringify(draft),
      });
    },
    onSuccess: () => {
      invalidate();
      toast({ title: editing ? t.saved : t.created });
      setEditing(null);
      setCreating(false);
      setDraft({});
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const remove = useMutation({
    mutationFn: (record: Record_) =>
      customFetch(`/api/bots/${botId}/plugin-data/${collection}/${record.id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast({ title: t.deleted });
      setDeleteTarget(null);
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t.loading}
      </div>
    );
  }

  if (error || !spec) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        {errMessage(error, t.errorGeneric)}
      </div>
    );
  }

  const records = data?.records ?? [];
  const canCreate = !spec.readonly && !spec.noCreate;
  const canEdit = !spec.readonly;

  // `spec` از `data?.spec` می‌آید؛ گاردِ بالا آن را برای استفاده‌ی مستقیم narrow
  // می‌کند ولی نه داخل این دو تابع (TS نمی‌تواند تضمین کند کِی صدا زده می‌شوند).
  const activeSpec: CollectionSpec = spec;

  function openCreate() {
    const defaults: Record<string, unknown> = {};
    for (const field of activeSpec.fields) {
      if (field.type !== "readonly" && field.default !== undefined) defaults[field.key] = field.default;
    }
    setDraft(defaults);
    setEditing(null);
    setCreating(true);
  }

  function openEdit(record: Record_) {
    const current: Record<string, unknown> = {};
    for (const field of activeSpec.fields) {
      if (field.type !== "readonly") current[field.key] = record[field.key];
    }
    setDraft(current);
    setEditing(record);
    setCreating(false);
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            {spec.titleFa}
            <Badge variant="outline" className="tabular-nums">{records.length.toLocaleString("fa-IR")}</Badge>
            {spec.readonly && (
              <Badge variant="secondary" className="gap-1">
                <Lock className="size-3" /> {t.readOnly}
              </Badge>
            )}
          </h3>
          {spec.descriptionFa && (
            <p className="max-w-2xl text-sm text-muted-foreground">{spec.descriptionFa}</p>
          )}
        </div>
        {canCreate && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" /> {t.add}
          </Button>
        )}
      </header>

      {records.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {spec.readonly ? t.emptyReadOnly : t.empty}
        </div>
      ) : (
        // جدول‌های عریض داخل خودشان اسکرول می‌شوند تا بدنه‌ی صفحه افقی اسکرول نکند.
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {spec.listColumns.map((column) => (
                  <TableHead key={column}>{fieldsByKey.get(column)?.label ?? column}</TableHead>
                ))}
                {canEdit && <TableHead className="w-24">{t.actions}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record) => (
                <TableRow key={record.id}>
                  {spec.listColumns.map((column) => (
                    <TableCell key={column} className="align-top text-sm">
                      {renderCell(fieldsByKey.get(column), record[column], "fa-IR")}
                    </TableCell>
                  ))}
                  {canEdit && (
                    <TableCell className="align-top">
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(record)} title={t.edit}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setDeleteTarget(record)}
                          title={t.delete}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={creating || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t.editTitle : t.addTitle}</DialogTitle>
            <DialogDescription>{spec.titleFa}</DialogDescription>
          </DialogHeader>
          <RecordForm spec={spec} initial={draft} onChange={setDraft} />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              {t.cancel}
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />}
              {t.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.deleteWarning}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && remove.mutate(deleteTarget)}
              disabled={remove.isPending}
            >
              {t.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
