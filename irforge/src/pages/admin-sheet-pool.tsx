import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import {
  Database,
  Plus,
  ExternalLink,
  Loader2,
  CheckCircle2,
  LinkIcon,
  Trash2,
  RefreshCw,
  Unlock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";

type SheetEntry = {
  id: string;
  sheetId: string;
  status: string;
  assignedBotId: string | null;
  createdAt: string;
};

const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}`;

export default function AdminSheetPool() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const [newSheet, setNewSheet] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<SheetEntry | null>(null);
  const [replaceValue, setReplaceValue] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "sheet-pool"],
    queryFn: () => customFetch<SheetEntry[]>("/api/sheet-pool"),
  });

  const available = data?.filter((s) => s.status === "available").length ?? 0;
  const assigned = data?.filter((s) => s.status === "assigned").length ?? 0;

  async function add() {
    const id = newSheet.trim();
    if (!id) return;
    setAdding(true);
    try {
      await customFetch("/api/sheet-pool", { method: "POST", body: JSON.stringify({ sheetId: id }) });
      toast({ title: fa ? "شیت اضافه شد" : "Sheet added" });
      setNewSheet("");
      await refetch();
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: fa ? "خطا" : "Error",
        description: e?.status === 409
          ? (fa ? "این شیت قبلاً توی pool هست." : "This sheet is already in the pool.")
          : e?.message,
      });
    } finally {
      setAdding(false);
    }
  }

  async function removeSheet(entry: SheetEntry) {
    if (entry.status === "assigned") {
      toast({
        variant: "destructive",
        title: fa ? "قابل حذف نیست" : "Can't delete",
        description: fa
          ? "این شیت به یک بات اختصاص داده شده. به‌جای حذف، جایگزینش کن."
          : "This sheet is assigned to a bot. Replace it instead of deleting.",
      });
      return;
    }
    if (confirmDeleteId !== entry.id) {
      setConfirmDeleteId(entry.id);
      return;
    }
    setBusyRow("delete:" + entry.id);
    try {
      await customFetch(`/api/sheet-pool/${entry.id}`, { method: "DELETE" });
      toast({ title: fa ? "شیت حذف شد" : "Sheet deleted" });
      await refetch();
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: fa ? "خطا" : "Error",
        description: e?.status === 409
          ? (fa ? "این شیت به یک بات اختصاص داده شده. به‌جای حذف، جایگزینش کن." : "This sheet is assigned to a bot. Replace it instead of deleting.")
          : e?.message,
      });
    } finally {
      setBusyRow(null);
      setConfirmDeleteId(null);
    }
  }

  function openReplace(entry: SheetEntry) {
    setReplaceTarget(entry);
    setReplaceValue("");
  }

  async function releaseSheet(entry: SheetEntry) {
    setBusyRow("release:" + entry.id);
    try {
      await customFetch(`/api/sheet-pool/${entry.id}/release`, { method: "POST" });
      toast({ title: fa ? "شیت خالی و آماده شد" : "Sheet freed up" });
      await refetch();
    } catch (e: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: e?.message });
    } finally {
      setBusyRow(null);
    }
  }

  async function submitReplace() {
    if (!replaceTarget) return;
    const id = replaceValue.trim();
    if (!id) return;
    setBusyRow("replace:" + replaceTarget.id);
    try {
      await customFetch(`/api/sheet-pool/${replaceTarget.id}/replace`, {
        method: "POST",
        body: JSON.stringify({ sheetId: id }),
      });
      toast({ title: fa ? "شیت جایگزین شد" : "Sheet replaced" });
      setReplaceTarget(null);
      setReplaceValue("");
      await refetch();
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: fa ? "خطا" : "Error",
        description: e?.status === 409
          ? (fa ? "این شیت قبلاً توی pool هست." : "This sheet is already in the pool.")
          : e?.message,
      });
    } finally {
      setBusyRow(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Database className="size-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{fa ? "استخر شیت" : "Sheet Pool"}</h1>
          <p className="text-sm text-muted-foreground">
            {fa ? "شیت‌های آماده که موقع تأیید پرداخت به بات‌ها اختصاص داده می‌شن." : "Ready sheets assigned to bots when a payment is approved."}
          </p>
        </div>
      </div>

      {/* counts */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: fa ? "کل" : "Total", value: data?.length ?? 0, tone: "text-foreground" },
          { label: fa ? "آزاد" : "Available", value: available, tone: "text-emerald-500" },
          { label: fa ? "اختصاص‌یافته" : "Assigned", value: assigned, tone: "text-amber-500" },
        ].map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className={`text-2xl font-bold ${c.tone}`}>{c.value.toLocaleString(fa ? "fa-IR" : "en-US")}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* add form */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <LinkIcon className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={newSheet}
              onChange={(e) => setNewSheet(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder={fa ? "Google Spreadsheet ID را وارد کن" : "Paste a Google Spreadsheet ID"}
              className="ps-9 font-mono text-sm"
              dir="ltr"
              data-testid="sheet-id-input"
            />
          </div>
          <Button onClick={add} disabled={adding || !newSheet.trim()} data-testid="add-sheet">
            {adding ? <Loader2 className="me-1.5 size-4 animate-spin" /> : <Plus className="me-1.5 size-4" />}
            {fa ? "افزودن شیت" : "Add sheet"}
          </Button>
        </CardContent>
      </Card>

      {/* list */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Card key={i} className="animate-pulse"><CardContent className="h-14" /></Card>)}
        </div>
      ) : error ? (
        <Card className="border-destructive/40">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {fa ? "دریافت فهرست ممکن نشد. دسترسی سوپرادمین لازمه." : "Couldn't load the list. Super-admin access is required."}
          </CardContent>
        </Card>
      ) : !data || data.length === 0 ? (
        <div className="rounded-xl border border-dashed py-14 text-center">
          <Database className="mx-auto mb-3 size-9 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {fa ? "هنوز شیتی توی pool نیست. یکی از بالا اضافه کن." : "No sheets in the pool yet. Add one above."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          {data.map((s, i) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.03 }}
              className="flex items-center gap-3 border-b p-3 last:border-b-0 hover:bg-muted/30"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" dir="ltr" title={s.sheetId}>
                {s.sheetId}
              </span>
              {s.status === "available" ? (
                <Badge className="shrink-0 gap-1 bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400">
                  <CheckCircle2 className="size-3" />
                  {fa ? "آزاد" : "Available"}
                </Badge>
              ) : (
                <Badge variant="secondary" className="shrink-0">
                  {fa ? "اختصاص‌یافته" : "Assigned"}
                </Badge>
              )}
              <a
                href={sheetUrl(s.sheetId)}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
                aria-label={fa ? "باز کردن شیت" : "Open sheet"}
              >
                <ExternalLink className="size-4" />
              </a>
              {s.status === "assigned" && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="shrink-0 size-8 text-muted-foreground hover:text-emerald-500"
                  aria-label={fa ? "خالی کردن شیت" : "Free up sheet"}
                  title={fa ? "خالی کردن و آماده‌سازی برای بات جدید" : "Free up for a new bot"}
                  disabled={busyRow === "release:" + s.id}
                  onClick={() => releaseSheet(s)}
                >
                  {busyRow === "release:" + s.id ? <Loader2 className="size-4 animate-spin" /> : <Unlock className="size-4" />}
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="shrink-0 size-8 text-muted-foreground hover:text-primary"
                aria-label={fa ? "جایگزینی شیت" : "Replace sheet"}
                onClick={() => openReplace(s)}
              >
                <RefreshCw className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="shrink-0 size-8 text-muted-foreground hover:text-destructive"
                aria-label={fa ? "حذف شیت" : "Delete sheet"}
                disabled={busyRow === "delete:" + s.id}
                onClick={() => removeSheet(s)}
              >
                {busyRow === "delete:" + s.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              </Button>
              {confirmDeleteId === s.id && (
                <span className="shrink-0 text-xs text-destructive">
                  {fa ? "دوباره بزن برای حذف قطعی" : "Click again to confirm"}
                </span>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {/* replace dialog */}
      <Dialog open={!!replaceTarget} onOpenChange={(open) => !open && setReplaceTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{fa ? "جایگزینی شیت" : "Replace sheet"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {replaceTarget && (
              <p className="truncate rounded-md bg-muted/50 p-2 font-mono text-xs text-muted-foreground" dir="ltr">
                {replaceTarget.sheetId}
              </p>
            )}
            {replaceTarget?.status === "assigned" && (
              <p className="text-xs text-amber-500">
                {fa
                  ? "این شیت به یک بات اختصاص داده شده — با جایگزینی، بات هم به‌طور خودکار به شیت جدید متصل می‌شه."
                  : "This sheet is assigned to a bot — replacing it will automatically re-point that bot to the new sheet."}
              </p>
            )}
            <div className="relative">
              <LinkIcon className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={replaceValue}
                onChange={(e) => setReplaceValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitReplace()}
                placeholder={fa ? "Google Spreadsheet ID جدید" : "New Google Spreadsheet ID"}
                className="ps-9 font-mono text-sm"
                dir="ltr"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={submitReplace}
              disabled={!replaceValue.trim() || (replaceTarget ? busyRow === "replace:" + replaceTarget.id : false)}
            >
              {replaceTarget && busyRow === "replace:" + replaceTarget.id ? (
                <Loader2 className="me-1.5 size-4 animate-spin" />
              ) : (
                <RefreshCw className="me-1.5 size-4" />
              )}
              {fa ? "جایگزین کن" : "Replace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
