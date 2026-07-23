import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  Database as DatabaseIcon,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  ExternalLink,
  RefreshCw,
  Table as TableIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";

type Target = { target: string; label: string; kind: string; sheetId: string };
type Row = { key: string; value: unknown; raw: boolean };

const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}`;

/** Display a parsed value as editable text: strings stay plain, objects pretty-print. */
function valueToText(value: unknown, raw: boolean): string {
  if (raw || typeof value === "string") return String(value ?? "");
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

/** Turn editor text back into a value: valid JSON → parsed, otherwise a raw string. */
function textToValue(text: string): unknown {
  const t = text.trim();
  if (t === "") return "";
  try {
    return JSON.parse(t);
  } catch {
    return text;
  }
}

/** Short one-line preview of a value for the table. */
function preview(value: unknown, raw: boolean): string {
  if (raw || typeof value === "string") return String(value ?? "");
  try {
    const s = JSON.stringify(value);
    return s.length > 90 ? s.slice(0, 89) + "…" : s;
  } catch {
    return String(value);
  }
}

export default function DatabasePage() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();

  const [target, setTarget] = useState<string>("");
  const [tab, setTab] = useState<string>("");

  // dialogs
  const [editRow, setEditRow] = useState<{ key: string; text: string; isNew: boolean } | null>(null);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [newTabOpen, setNewTabOpen] = useState(false);
  const [newTabName, setNewTabName] = useState("");
  const [busy, setBusy] = useState(false);

  const t = (f: string, e: string) => (fa ? f : e);

  // ─── targets ──────────────────────────────────────────────────────────────
  const targetsQ = useQuery({
    queryKey: ["db", "targets"],
    queryFn: () => customFetch<{ targets: Target[]; isSuperAdmin: boolean }>("/api/database/targets"),
  });

  const targets = targetsQ.data?.targets ?? [];
  useEffect(() => {
    if (!target && targets.length) setTarget(targets[0].target);
  }, [targets, target]);

  const activeTarget = targets.find((x) => x.target === target);

  // ─── tabs ─────────────────────────────────────────────────────────────────
  const tabsQ = useQuery({
    queryKey: ["db", "tabs", target],
    queryFn: () => customFetch<{ tabs: string[]; label: string }>(`/api/database/${encodeURIComponent(target)}/tabs`),
    enabled: !!target,
  });
  const tabs = useMemo(() => tabsQ.data?.tabs ?? [], [tabsQ.data]);
  useEffect(() => {
    if (tabs.length && !tabs.includes(tab)) setTab(tabs[0]);
  }, [tabs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── rows ─────────────────────────────────────────────────────────────────
  const rowsQ = useQuery({
    queryKey: ["db", "rows", target, tab],
    queryFn: () => customFetch<{ rows: Row[] }>(`/api/database/${encodeURIComponent(target)}/tabs/${encodeURIComponent(tab)}/rows`),
    enabled: !!target && !!tab,
  });
  const rows = rowsQ.data?.rows ?? [];

  const base = `/api/database/${encodeURIComponent(target)}/tabs/${encodeURIComponent(tab)}/rows`;

  async function saveRow() {
    if (!editRow) return;
    const key = editRow.key.trim();
    if (!key) { toast({ variant: "destructive", title: t("کلید لازم است", "Key is required") }); return; }
    setBusy(true);
    try {
      const value = textToValue(editRow.text);
      if (editRow.isNew) {
        await customFetch(base, { method: "POST", body: JSON.stringify({ key, value }) });
      } else {
        await customFetch(`${base}/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ value }) });
      }
      toast({ title: t("ذخیره شد", "Saved") });
      setEditRow(null);
      await rowsQ.refetch();
    } catch (e: any) {
      toast({ variant: "destructive", title: t("خطا", "Error"), description: e?.status === 409 ? t("این کلید از قبل هست.", "Key already exists.") : e?.message });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteKey) return;
    setBusy(true);
    try {
      await customFetch(`${base}/${encodeURIComponent(deleteKey)}`, { method: "DELETE" });
      toast({ title: t("حذف شد", "Deleted") });
      setDeleteKey(null);
      await rowsQ.refetch();
    } catch (e: any) {
      toast({ variant: "destructive", title: t("خطا", "Error"), description: e?.message });
    } finally {
      setBusy(false);
    }
  }

  async function createTab() {
    const name = newTabName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await customFetch(`/api/database/${encodeURIComponent(target)}/tabs`, { method: "POST", body: JSON.stringify({ name }) });
      toast({ title: t("تب ساخته شد", "Tab created") });
      setNewTabName("");
      setNewTabOpen(false);
      await tabsQ.refetch();
      setTab(name);
    } catch (e: any) {
      toast({ variant: "destructive", title: t("خطا", "Error"), description: e?.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <DatabaseIcon className="size-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{t("دیتابیس", "Database")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("مستقیم روی همون گوگل‌شیت‌هایی که بات می‌خونه ویرایش کن — اضافه، تغییر و حذف.", "Edit the exact Google Sheets the bot reads — add, change, delete.")}
          </p>
        </div>
        {activeTarget && (
          <a href={sheetUrl(activeTarget.sheetId)} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm">
              <ExternalLink className="me-1.5 size-4" />
              {t("باز کردن در گوگل", "Open in Google")}
            </Button>
          </a>
        )}
      </div>

      {/* target + tab selectors */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted-foreground">{t("دیتابیس (بات/سیستم)", "Database (bot/system)")}</label>
            <Select value={target} onValueChange={(v) => { setTarget(v); setTab(""); }}>
              <SelectTrigger data-testid="db-target"><SelectValue placeholder={t("انتخاب کن", "Select")} /></SelectTrigger>
              <SelectContent>
                {targets.map((x) => (
                  <SelectItem key={x.target} value={x.target}>
                    {x.label}{x.kind !== "bot" ? ` · ${t("سیستمی", "system")}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="ghost" size="icon" className="mt-4 shrink-0" onClick={() => { tabsQ.refetch(); rowsQ.refetch(); }} aria-label={t("تازه‌سازی", "Refresh")}>
            <RefreshCw className="size-4" />
          </Button>
        </CardContent>
      </Card>

      {targetsQ.isLoading ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 size-5 animate-spin" />{t("در حال بارگذاری…", "Loading…")}</CardContent></Card>
      ) : targets.length === 0 ? (
        <div className="rounded-xl border border-dashed py-14 text-center">
          <DatabaseIcon className="mx-auto mb-3 size-9 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("هنوز باتی با شیت اختصاصی نداری. اول یه بات بساز و شیت بهش وصل کن.", "No bot with a sheet yet. Create a bot and attach a sheet first.")}</p>
        </div>
      ) : (
        <>
          {/* tabs row */}
          <div className="flex flex-wrap items-center gap-2">
            {tabsQ.isLoading ? (
              <span className="text-sm text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /> {t("تب‌ها…", "Tabs…")}</span>
            ) : tabs.map((tb) => (
              <button
                key={tb}
                onClick={() => setTab(tb)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${tb === tab ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/40"}`}
                data-testid={`db-tab-${tb}`}
              >
                <TableIcon className="size-3" />{tb}
              </button>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setNewTabOpen(true)}>
              <Plus className="me-1 size-3.5" />{t("تب جدید", "New tab")}
            </Button>
          </div>

          {/* rows */}
          <Card>
            <CardContent className="p-0">
              <div className="flex items-center justify-between border-b p-3">
                <span className="text-sm font-medium">
                  {tab || t("یک تب انتخاب کن", "Pick a tab")}
                  {rows.length > 0 && <span className="ms-2 text-xs text-muted-foreground">({rows.length.toLocaleString(fa ? "fa-IR" : "en-US")})</span>}
                </span>
                <Button size="sm" disabled={!tab} onClick={() => setEditRow({ key: "", text: "", isNew: true })} data-testid="db-add-row">
                  <Plus className="me-1.5 size-4" />{t("ردیف جدید", "New row")}
                </Button>
              </div>

              {rowsQ.isLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 size-5 animate-spin" />{t("در حال بارگذاری…", "Loading…")}</div>
              ) : rows.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">{t("این تب خالیه.", "This tab is empty.")}</div>
              ) : (
                <div className="divide-y">
                  {rows.map((r) => (
                    <div key={r.key} className="flex items-center gap-3 p-3 hover:bg-muted/30">
                      <span className="w-40 shrink-0 truncate font-mono text-xs text-primary" dir="ltr" title={r.key}>{r.key}</span>
                      <span className="flex-1 truncate font-mono text-xs text-muted-foreground" dir="ltr" title={preview(r.value, r.raw)}>{preview(r.value, r.raw)}</span>
                      <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => setEditRow({ key: r.key, text: valueToText(r.value, r.raw), isNew: false })} aria-label={t("ویرایش", "Edit")}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8 shrink-0 text-destructive hover:text-destructive" onClick={() => setDeleteKey(r.key)} aria-label={t("حذف", "Delete")}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* edit / add row dialog */}
      <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editRow?.isNew ? t("ردیف جدید", "New row") : t("ویرایش ردیف", "Edit row")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t("کلید (key)", "Key")}</label>
              <Input
                value={editRow?.key ?? ""}
                onChange={(e) => setEditRow((s) => s && { ...s, key: e.target.value })}
                disabled={!editRow?.isNew}
                className="font-mono text-sm" dir="ltr"
                data-testid="db-row-key"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t("مقدار (متن یا JSON)", "Value (text or JSON)")}</label>
              <Textarea
                value={editRow?.text ?? ""}
                onChange={(e) => setEditRow((s) => s && { ...s, text: e.target.value })}
                rows={9} className="font-mono text-sm" dir="ltr"
                data-testid="db-row-value"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">{t("اگه JSON معتبر باشه به‌صورت آبجکت ذخیره می‌شه، وگرنه متن ساده.", "Valid JSON is stored as an object; otherwise plain text.")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>{t("انصراف", "Cancel")}</Button>
            <Button onClick={saveRow} disabled={busy} data-testid="db-save-row">
              {busy && <Loader2 className="me-1.5 size-4 animate-spin" />}{t("ذخیره", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* new tab dialog */}
      <Dialog open={newTabOpen} onOpenChange={setNewTabOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t("تب جدید", "New tab")}</DialogTitle></DialogHeader>
          <Input value={newTabName} onChange={(e) => setNewTabName(e.target.value)} placeholder={t("مثلاً bot_settings", "e.g. bot_settings")} className="font-mono text-sm" dir="ltr" onKeyDown={(e) => e.key === "Enter" && createTab()} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewTabOpen(false)}>{t("انصراف", "Cancel")}</Button>
            <Button onClick={createTab} disabled={busy || !newTabName.trim()}>{busy && <Loader2 className="me-1.5 size-4 animate-spin" />}{t("بساز", "Create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* delete confirm */}
      <AlertDialog open={!!deleteKey} onOpenChange={(o) => !o && setDeleteKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("حذف ردیف؟", "Delete row?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("ردیف با کلید", "The row with key")} <span className="font-mono text-foreground" dir="ltr">{deleteKey}</span> {t("برای همیشه از شیت حذف می‌شه.", "will be permanently removed from the sheet.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("انصراف", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {busy && <Loader2 className="me-1.5 size-4 animate-spin" />}{t("حذف", "Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
