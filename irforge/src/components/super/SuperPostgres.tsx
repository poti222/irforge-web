import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AlertTriangle, ChevronLeft, ChevronRight, Database, Loader2, Lock, Pencil, Plus, Search, Terminal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RefreshButton } from "@/components/ui/refresh-button";
import { useToast } from "@/hooks/use-toast";

/**
 * components/super/SuperPostgres.tsx — `/super` ← «دیتابیس»: مرور و ویرایشِ مرتبِ Postgres.
 * API: api-server/src/routes/superPostgres.ts (پشتِ سوپرادمین + رمزِ دومِ /super).
 *
 *  - دو دیتابیس: «سایت» (کاربران/ربات‌ها/مدارس/پرداخت‌ها…) و «دیتای ربات‌ها» (هر ربات = یک tenant با RLS).
 *  - جدول‌ها گروه‌بندی‌شده؛ هر جدول: جستجو، مرتب‌سازی، صفحه‌بندی، درج/ویرایش/حذف با کلیدِ اصلی.
 *  - ستون‌هایِ حساس (token/password/hash…) در سرور ماسک می‌شوند و قابلِ ویرایش نیستند.
 *  - کنسولِ SQL: پیش‌فرض فقط‌خواندنی؛ نوشتن فقط با تایپِ WRITE.
 */

const opts = { credentials: "include" as any };
const ROOT = "super-pg";
const PAGE_SIZES = [25, 50, 100];

interface DbInfo { id: "main" | "business"; label: string; description: string; available: boolean }
interface TableInfo {
  name: string; group: string; groupFa: string; groupOrder: number; estimatedRows: number; bytes: number;
  rls: boolean; hasPk: boolean; needsTenant: boolean;
}
interface Col {
  name: string; type: string; udt: string; nullable: boolean; hasDefault: boolean; isPk: boolean;
  isIdentity: boolean; isGenerated: boolean; masked: boolean;
}
interface RowsResp {
  rows: Record<string, unknown>[]; total: number | null; limit: number; offset: number;
  columns: Col[]; primaryKey: string[]; editable: boolean; needsTenant: boolean;
}
interface Tenant { botId: string; name: string; tenant: string; status: string }
interface QueryResp { command: string; rowCount: number | null; fields: string[]; rows: Record<string, unknown>[]; truncated: boolean; ms: number }

const get = <T,>(path: string) => customFetch<T>(`/api/super/pg${path}`, opts);
const send = <T,>(path: string, method: string, body: unknown) =>
  customFetch<T>(`/api/super/pg${path}`, { ...opts, method, body: JSON.stringify(body) });
const errText = (e: any) => e?.data?.error ?? e?.message ?? "خطا";

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function Cell({ v, col }: { v: unknown; col?: Col }) {
  if (col?.masked && v !== null) return <span className="inline-flex items-center gap-1 text-muted-foreground"><Lock className="size-3" />••••</span>;
  if (v === null || v === undefined) return <span className="text-xs italic text-muted-foreground">NULL</span>;
  if (typeof v === "boolean") return <span className={v ? "text-emerald-500" : "text-muted-foreground"}>{v ? "✓ true" : "✗ false"}</span>;
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return <span title={s.length > 60 ? s.slice(0, 600) : undefined}>{s.length > 60 ? `${s.slice(0, 60)}…` : s}</span>;
}

// ─── فرمِ درج/ویرایش ───────────────────────────────────────────────────────

function RowDialog({
  open, onClose, mode, table, columns, row, tenant, db, onDone,
}: {
  open: boolean; onClose: () => void; mode: "insert" | "edit"; table: string; columns: Col[];
  row: Record<string, unknown> | null; tenant: string | null; db: string; onDone: () => void;
}) {
  const { toast } = useToast();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [nulls, setNulls] = useState<Record<string, boolean>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const fields = columns.filter((c) => !c.masked && !c.isGenerated && !(mode === "insert" && c.name === "tenant_id" && !!tenant));

  useEffect(() => {
    if (!open) return;
    const v: Record<string, string> = {};
    const n: Record<string, boolean> = {};
    for (const c of fields) {
      const cur = row?.[c.name];
      if (mode === "edit") {
        n[c.name] = cur === null || cur === undefined;
        v[c.name] = cur === null || cur === undefined ? "" : typeof cur === "object" ? JSON.stringify(cur, null, 2) : String(cur);
      } else {
        n[c.name] = false;
        v[c.name] = "";
      }
    }
    setVals(v); setNulls(n); setTouched({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row, mode, table]);

  function convert(c: Col, raw: string): unknown {
    if (c.udt === "json" || c.udt === "jsonb") return JSON.parse(raw);
    if (c.udt === "bool") return raw === "true";
    return raw;
  }

  async function submit() {
    const values: Record<string, unknown> = {};
    try {
      for (const c of fields) {
        if (mode === "edit" && c.isPk) continue;
        if (!touched[c.name]) continue;
        values[c.name] = nulls[c.name] ? null : convert(c, vals[c.name] ?? "");
      }
    } catch {
      toast({ variant: "destructive", title: "JSON نامعتبر", description: "مقدارِ یکی از ستون‌هایِ JSON درست نیست" });
      return;
    }
    if (mode === "edit" && Object.keys(values).length === 0) { onClose(); return; }
    setBusy(true);
    try {
      if (mode === "insert") await send(`/${db}/tables/${table}/rows`, "POST", { tenant, values });
      else {
        const pk = Object.fromEntries(columns.filter((c) => c.isPk).map((c) => [c.name, row?.[c.name]]));
        await send(`/${db}/tables/${table}/rows`, "PATCH", { tenant, pk, values });
      }
      toast({ title: mode === "insert" ? "ردیف اضافه شد" : "ذخیره شد" });
      onDone();
      onClose();
    } catch (e: any) {
      toast({ variant: "destructive", title: "خطا", description: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && !o && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode === "insert" ? "ردیفِ جدید" : "ویرایشِ ردیف"} — <span dir="ltr">{table}</span></DialogTitle>
          <DialogDescription>فقط ستون‌هایی که دست بزنی ذخیره می‌شوند. ستون‌هایِ حساس (🔒) از این‌جا ویرایش نمی‌شوند.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {fields.map((c) => {
            const disabled = mode === "edit" && c.isPk;
            const isJson = c.udt === "json" || c.udt === "jsonb";
            const long = isJson || (vals[c.name]?.length ?? 0) > 80;
            const set = (val: string) => { setVals((s) => ({ ...s, [c.name]: val })); setTouched((s) => ({ ...s, [c.name]: true })); setNulls((s) => ({ ...s, [c.name]: false })); };
            return (
              <div key={c.name} className="space-y-1">
                <Label className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span dir="ltr" className="font-mono">{c.name}</span>
                  <span className="text-muted-foreground" dir="ltr">{c.type}</span>
                  {c.isPk && <Badge variant="outline" className="h-4 px-1 text-[10px]">PK</Badge>}
                  {mode === "insert" && c.hasDefault && <span className="text-muted-foreground">(پیش‌فرض)</span>}
                </Label>
                <div className="flex items-start gap-2">
                  {c.udt === "bool" ? (
                    <Select value={nulls[c.name] ? "null" : vals[c.name] || ""} onValueChange={(v) => (v === "null" ? (setNulls((s) => ({ ...s, [c.name]: true })), setTouched((s) => ({ ...s, [c.name]: true }))) : set(v))} disabled={disabled}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">true</SelectItem>
                        <SelectItem value="false">false</SelectItem>
                        {c.nullable && <SelectItem value="null">NULL</SelectItem>}
                      </SelectContent>
                    </Select>
                  ) : long ? (
                    <Textarea value={vals[c.name] ?? ""} onChange={(e) => set(e.target.value)} disabled={disabled || nulls[c.name]} rows={isJson ? 6 : 3} dir="ltr" className="font-mono text-xs" />
                  ) : (
                    <Input value={vals[c.name] ?? ""} onChange={(e) => set(e.target.value)} disabled={disabled || nulls[c.name]} dir="auto" />
                  )}
                  {c.nullable && c.udt !== "bool" && !disabled && (
                    <label className="flex shrink-0 items-center gap-1 pt-2 text-xs text-muted-foreground">
                      <Checkbox checked={!!nulls[c.name]} onCheckedChange={(v) => { setNulls((s) => ({ ...s, [c.name]: !!v })); setTouched((s) => ({ ...s, [c.name]: true })); }} />
                      NULL
                    </label>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>انصراف</Button>
          <Button onClick={submit} disabled={busy}>{busy && <Loader2 className="me-1.5 size-4 animate-spin" />}ذخیره</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── نمایِ یک جدول ─────────────────────────────────────────────────────────

function TableView({ db, table, tenant, info }: { db: string; table: string; tenant: string | null; info?: TableInfo }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [sort, setSort] = useState<string | undefined>();
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [edit, setEdit] = useState<{ mode: "insert" | "edit"; row: Record<string, unknown> | null } | null>(null);
  const [del, setDel] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setQ(""); setApplied(""); setSort(undefined); setOffset(0); }, [db, table, tenant]);

  const needTenant = !!info?.needsTenant && db === "business" && !tenant;
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (applied) params.set("q", applied);
  if (sort) { params.set("sort", sort); params.set("dir", dir); }
  if (tenant) params.set("tenant", tenant);
  const key = [ROOT, "rows", db, table, tenant, applied, sort, dir, limit, offset];
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: key,
    queryFn: () => get<RowsResp>(`/${db}/tables/${table}/rows?${params}`),
    enabled: !needTenant,
    placeholderData: (p) => p,
    retry: false,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: [ROOT, "rows", db, table] });
  const cols = data?.columns ?? [];

  async function doDelete() {
    if (!del || !data) return;
    setBusy(true);
    try {
      const pk = Object.fromEntries(data.primaryKey.map((k) => [k, del[k]]));
      await send(`/${db}/tables/${table}/rows`, "DELETE", { tenant, pk });
      toast({ title: "ردیف حذف شد" });
      setDel(null);
      refresh();
    } catch (e: any) {
      toast({ variant: "destructive", title: "خطا", description: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  if (needTenant) {
    return (
      <Card><CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <AlertTriangle className="size-4 text-amber-500" /> این جدولِ دیتای رباتی است؛ اول از بالا یک ربات (tenant) انتخاب کن.
      </CardContent></Card>
    );
  }

  const from = (data?.offset ?? 0) + 1;
  const to = (data?.offset ?? 0) + (data?.rows.length ?? 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-mono text-base font-semibold" dir="ltr">{table}</h3>
        {info?.rls && <Badge variant="outline">RLS</Badge>}
        {data && !data.editable && <Badge variant="secondary">فقط‌خواندنی (بدونِ کلیدِ اصلی)</Badge>}
        <div className="ms-auto flex items-center gap-2">
          <RefreshButton queryKeys={[[ROOT, "rows", db, table]]} label="به‌روزرسانی" />
          {data?.editable && <Button size="sm" onClick={() => setEdit({ mode: "insert", row: null })}><Plus className="me-1 size-4" />ردیفِ جدید</Button>}
        </div>
      </div>

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setOffset(0); setApplied(q); }}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو در همه‌ی ستون‌ها…" className="ps-8" dir="auto" />
        </div>
        <Button type="submit" variant="secondary">جستجو</Button>
        {applied && <Button type="button" variant="ghost" onClick={() => { setQ(""); setApplied(""); setOffset(0); }}>پاک</Button>}
      </form>

      {error && <p className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{errText(error)}</p>}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16" />
              {cols.map((c) => (
                <TableHead key={c.name} className="whitespace-nowrap">
                  <button
                    type="button" disabled={c.masked}
                    onClick={() => { if (sort === c.name) setDir((d) => (d === "asc" ? "desc" : "asc")); else { setSort(c.name); setDir("asc"); } setOffset(0); }}
                    className="flex items-center gap-1 font-mono text-xs hover:text-foreground" dir="ltr" title={c.type}
                  >
                    {c.isPk && <span className="text-amber-500">🔑</span>}{c.masked && <Lock className="size-3" />}{c.name}
                    {sort === c.name && <span>{dir === "asc" ? "▲" : "▼"}</span>}
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={cols.length + 1 || 2} className="h-24 text-center"><Loader2 className="mx-auto size-5 animate-spin" /></TableCell></TableRow>}
            {data?.rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="whitespace-nowrap">
                  {data.editable && (
                    <div className="flex gap-0.5">
                      <Button size="icon" variant="ghost" className="size-7" onClick={() => setEdit({ mode: "edit", row: r })} title="ویرایش"><Pencil className="size-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="size-7 text-destructive" onClick={() => setDel(r)} title="حذف"><Trash2 className="size-3.5" /></Button>
                    </div>
                  )}
                </TableCell>
                {cols.map((c) => <TableCell key={c.name} className="max-w-[18rem] whitespace-nowrap text-xs" dir="auto"><Cell v={r[c.name]} col={c} /></TableCell>)}
              </TableRow>
            ))}
            {data && data.rows.length === 0 && <TableRow><TableCell colSpan={cols.length + 1} className="h-20 text-center text-sm text-muted-foreground">ردیفی نیست</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {data && data.rows.length > 0 ? `${from}–${to}` : "0"}{data?.total != null ? ` از ${data.total.toLocaleString()}` : " (تعدادِ کل گران بود)"}
          {isFetching && <Loader2 className="ms-2 inline size-3 animate-spin" />}
        </span>
        <div className="flex items-center gap-2">
          <Select value={String(limit)} onValueChange={(v) => { setLimit(Number(v)); setOffset(0); }}>
            <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
            <SelectContent>{PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="icon" variant="outline" className="size-8" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}><ChevronRight className="size-4" /></Button>
          <Button size="icon" variant="outline" className="size-8" disabled={!data || data.rows.length < limit || (data.total != null && offset + limit >= data.total)} onClick={() => setOffset(offset + limit)}><ChevronLeft className="size-4" /></Button>
        </div>
      </div>

      {edit && data && (
        <RowDialog open onClose={() => setEdit(null)} mode={edit.mode} table={table} columns={cols} row={edit.row} tenant={tenant} db={db} onDone={refresh} />
      )}

      <Dialog open={!!del} onOpenChange={(o) => !busy && !o && setDel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>حذفِ این ردیف؟</DialogTitle>
            <DialogDescription>این کار برگشت‌پذیر نیست و در ردپا ثبت می‌شود. دقیقاً یک ردیف حذف می‌شود، وگرنه عملیات لغو می‌شود.</DialogDescription>
          </DialogHeader>
          <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 text-xs" dir="ltr">
            {del && data ? JSON.stringify(Object.fromEntries(data.primaryKey.map((k) => [k, del[k]])), null, 2) : ""}
          </pre>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setDel(null)} disabled={busy}>انصراف</Button>
            <Button variant="destructive" onClick={doDelete} disabled={busy}>{busy && <Loader2 className="me-1.5 size-4 animate-spin" />}حذف</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── کنسولِ SQL ────────────────────────────────────────────────────────────

function SqlConsole({ db, tenant }: { db: string; tenant: string | null }) {
  const { toast } = useToast();
  const [sql, setSql] = useState("SELECT now();");
  const [write, setWrite] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<QueryResp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true); setErr(null); setRes(null);
    try {
      setRes(await send<QueryResp>(`/${db}/query`, "POST", { sql, tenant, mode: write ? "write" : "read", confirm: write ? confirm : undefined }));
      if (write) setConfirm("");
    } catch (e: any) {
      setErr(errText(e));
      toast({ variant: "destructive", title: "خطا در اجرا" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Textarea value={sql} onChange={(e) => setSql(e.target.value)} rows={6} dir="ltr" className="font-mono text-sm" spellCheck={false} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={write} onCheckedChange={(v) => { setWrite(!!v); setConfirm(""); }} />
          حالتِ نوشتن (خطرناک)
        </label>
        {write && <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="برای تأیید بنویس: WRITE" className="w-52" dir="ltr" />}
        <Button onClick={run} disabled={busy || !sql.trim() || (write && confirm !== "WRITE")} className="ms-auto">
          {busy ? <Loader2 className="me-1.5 size-4 animate-spin" /> : <Terminal className="me-1.5 size-4" />}اجرا
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        یک دستور در هر اجرا. حالتِ عادی در تراکنشِ فقط‌خواندنی با محدودیتِ ۸ ثانیه اجرا می‌شود. حالتِ نوشتن در ردپا ثبت می‌شود.
        {db === "business" && !tenant && " برای جدول‌هایِ دیتای رباتی ابتدا یک ربات انتخاب کن (RLS)."}
      </p>
      {err && <p className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive" dir="auto">{err}</p>}
      {res && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{res.command} · {res.rowCount ?? 0} ردیف · {res.ms}ms{res.truncated ? " · بیش‌ازحد، فقط بخشی نمایش داده شد" : ""}</p>
          {res.fields.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader><TableRow>{res.fields.map((f) => <TableHead key={f} className="font-mono text-xs" dir="ltr">{f}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  {res.rows.map((r, i) => (
                    <TableRow key={i}>{res.fields.map((f) => <TableCell key={f} className="max-w-[20rem] whitespace-nowrap text-xs" dir="auto"><Cell v={r[f]} /></TableCell>)}</TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── صفحه ──────────────────────────────────────────────────────────────────

export function SuperPostgres() {
  const [db, setDb] = useState<"main" | "business">("main");
  const [tenant, setTenant] = useState<string | null>(null);
  const [table, setTable] = useState<string | null>(null);
  const [console_, setConsole] = useState(false);
  const [filter, setFilter] = useState("");

  const dbs = useQuery({ queryKey: [ROOT, "dbs"], queryFn: () => get<{ databases: DbInfo[] }>("/databases"), retry: false });
  const tables = useQuery({ queryKey: [ROOT, "tables", db], queryFn: () => get<{ tables: TableInfo[] }>(`/${db}/tables`), retry: false });
  const tenants = useQuery({ queryKey: [ROOT, "tenants"], queryFn: () => get<{ tenants: Tenant[] }>("/business/tenants"), enabled: db === "business", retry: false });

  useEffect(() => { setTable(null); setTenant(null); setConsole(false); }, [db]);

  const groups = useMemo(() => {
    const list = (tables.data?.tables ?? []).filter((t) => !filter || t.name.toLowerCase().includes(filter.toLowerCase()));
    const map = new Map<string, { fa: string; order: number; items: TableInfo[] }>();
    for (const t of list) {
      const g = map.get(t.group) ?? { fa: t.groupFa, order: t.groupOrder, items: [] };
      g.items.push(t);
      map.set(t.group, g);
    }
    return [...map.values()].sort((a, b) => a.order - b.order);
  }, [tables.data, filter]);

  const info = tables.data?.tables.find((t) => t.name === table);
  const businessAvailable = dbs.data?.databases.find((d) => d.id === "business")?.available;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(dbs.data?.databases ?? [{ id: "main", label: "دیتابیسِ سایت", available: true } as DbInfo]).map((d) => (
          <Button key={d.id} variant={db === d.id ? "default" : "outline"} size="sm" disabled={!d.available} onClick={() => setDb(d.id)}>
            <Database className="me-1.5 size-4" />{d.label}
          </Button>
        ))}
        {db === "business" && (
          <Select value={tenant ?? "__none__"} onValueChange={(v) => setTenant(v === "__none__" ? null : v)}>
            <SelectTrigger className="w-56"><SelectValue placeholder="ربات (tenant)" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— یک ربات انتخاب کن —</SelectItem>
              {tenants.data?.tenants.map((t) => <SelectItem key={t.tenant} value={t.tenant}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button variant={console_ ? "default" : "outline"} size="sm" className="ms-auto" onClick={() => setConsole((v) => !v)}>
          <Terminal className="me-1.5 size-4" />کنسولِ SQL
        </Button>
      </div>
      {dbs.data && !businessAvailable && db === "main" && (
        <p className="text-xs text-muted-foreground">دیتابیسِ رباتی وصل نیست (BUSINESS_DATABASE_URL روی سرویس تنظیم نشده).</p>
      )}

      <div className="grid gap-4 md:grid-cols-[17rem_minmax(0,1fr)]">
        <Card className="md:max-h-[75vh] md:overflow-y-auto">
          <CardContent className="space-y-3 p-3">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="فیلترِ جدول‌ها…" dir="ltr" className="h-8" />
            {tables.isLoading && <Loader2 className="mx-auto size-5 animate-spin" />}
            {tables.error && <p className="text-xs text-destructive">{errText(tables.error)}</p>}
            {groups.map((g) => (
              <div key={g.fa} className="space-y-0.5">
                <p className="px-1 text-[11px] font-semibold text-muted-foreground">{g.fa} <span className="font-normal">({g.items.length})</span></p>
                {g.items.map((t) => (
                  <button
                    key={t.name} type="button" onClick={() => { setTable(t.name); setConsole(false); }}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-start text-xs transition-colors ${table === t.name && !console_ ? "bg-primary/15 font-semibold text-primary" : "hover:bg-muted"}`}
                  >
                    <span className="truncate font-mono" dir="ltr">{t.name}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{t.estimatedRows > 0 ? `~${t.estimatedRows.toLocaleString()}` : ""} {fmtBytes(t.bytes)}</span>
                  </button>
                ))}
              </div>
            ))}
            {tables.data && groups.length === 0 && <p className="text-center text-xs text-muted-foreground">جدولی پیدا نشد</p>}
          </CardContent>
        </Card>

        <div className="min-w-0">
          {console_ ? (
            <SqlConsole db={db} tenant={tenant} />
          ) : table ? (
            <TableView db={db} table={table} tenant={tenant} info={info} />
          ) : (
            <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">یک جدول را از فهرست انتخاب کن.</CardContent></Card>
          )}
        </div>
      </div>
    </div>
  );
}
