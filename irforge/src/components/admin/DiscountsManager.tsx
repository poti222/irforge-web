import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Percent, Trash2, Loader2, Plus } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";

type DiscountKind = "percent" | "fixed";

type DiscountCode = {
  id: string;
  code: string;
  kind: DiscountKind;
  value: number;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

const QUERY_KEY = ["admin-discounts"];

/**
 * discounts.ts isn't in the OpenAPI spec (Phase 9 didn't regenerate it), so
 * this talks to the raw endpoints via customFetch — same pattern tickets.tsx
 * uses for routes with no generated hook. ApiError has the same
 * `{ data: { error } }` shape as the generated client's ApiError.
 */
function serverMessage(err: any): string | undefined {
  const reason = err?.data?.error;
  return typeof reason === "string" && reason.trim() !== "" ? reason : err?.message;
}

function isExpired(c: DiscountCode): boolean {
  return !!c.expiresAt && new Date(c.expiresAt).getTime() < Date.now();
}
function isExhausted(c: DiscountCode): boolean {
  return c.maxUses != null && c.usedCount >= c.maxUses;
}

export function DiscountsManager() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: codes, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => customFetch<DiscountCode[]>("/api/admin/discounts"),
  });

  const [code, setCode] = useState("");
  const [kind, setKind] = useState<DiscountKind>("percent");
  const [value, setValue] = useState("");
  const [maxUses, setMaxUses] = useState(""); // empty = unlimited
  const [expiresAt, setExpiresAt] = useState(""); // empty = never expires
  const [active, setActive] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DiscountCode | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  /**
   * The delete endpoints hand back the post-delete list, so we write it into
   * the cache directly instead of invalidating and refetching. Sheets is not
   * read-your-writes consistent: a refetch here often returned the pre-delete
   * snapshot, the row reappeared, and the operator concluded the delete had
   * failed when it had actually succeeded.
   */
  const putList = (rows: DiscountCode[]) => queryClient.setQueryData(QUERY_KEY, rows);

  const list = codes ?? [];
  const selectedSet = new Set(selected);
  // Selection can outlive the rows it points at (another admin deletes one).
  const liveSelected = list.filter((c) => selectedSet.has(c.id));
  const allSelected = list.length > 0 && liveSelected.length === list.length;

  function toggleOne(id: string, on: boolean) {
    setSelected((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
  }
  function toggleAll(on: boolean) {
    setSelected(on ? list.map((c) => c.id) : []);
  }

  async function create() {
    const trimmedCode = code.trim().toUpperCase();
    const numValue = Number(value);
    if (!trimmedCode) {
      toast({ variant: "destructive", title: fa ? "کد تخفیف را وارد کن" : "A discount code is required" });
      return;
    }
    if (!Number.isFinite(numValue) || !Number.isInteger(numValue)) {
      toast({ variant: "destructive", title: fa ? "مقدار باید عدد صحیح باشد" : "Value must be an integer" });
      return;
    }
    setCreating(true);
    try {
      const created = await customFetch<DiscountCode>("/api/admin/discounts", {
        method: "POST",
        body: JSON.stringify({
          code: trimmedCode,
          kind,
          value: numValue,
          maxUses: maxUses.trim() === "" ? null : Number(maxUses),
          expiresAt: expiresAt.trim() === "" ? null : new Date(expiresAt).toISOString(),
          active,
        }),
      });
      invalidate();
      setCode(""); setValue(""); setMaxUses(""); setExpiresAt(""); setKind("percent"); setActive(true);
      toast({ title: fa ? `کد ${created.code} ساخته شد` : `Code ${created.code} created` });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: serverMessage(err) });
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(c: DiscountCode) {
    setBusyId(c.id);
    try {
      await customFetch(`/api/admin/discounts/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !c.active }),
      });
      invalidate();
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: serverMessage(err) });
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const rows = await customFetch<DiscountCode[]>(`/api/admin/discounts/${deleteTarget.id}`, {
        method: "DELETE",
      });
      putList(rows);
      setSelected((prev) => prev.filter((x) => x !== deleteTarget.id));
      toast({ title: fa ? "کد تخفیف حذف شد" : "Discount code deleted" });
      setDeleteTarget(null);
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا در حذف" : "Delete failed", description: serverMessage(err) });
    } finally {
      setDeleting(false);
    }
  }

  /**
   * One request for the whole selection. Deliberately NOT a loop over the
   * single-delete endpoint: each delete rewrites the entire sheet tab, so N
   * parallel deletes race and resurrect each other's rows — the bug this
   * screen exists to stop.
   */
  async function confirmBulkDelete() {
    const ids = liveSelected.map((c) => c.id);
    if (ids.length === 0) return;
    setDeleting(true);
    try {
      const res = await customFetch<{
        requested: number; deleted: number; deletedIds: string[]; codes: DiscountCode[];
      }>("/api/admin/discounts/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      putList(res.codes);
      setSelected([]);
      setBulkOpen(false);
      // Report what actually happened. Some ids can already be gone if another
      // admin got there first, and claiming we deleted them would be a lie.
      const short = res.deleted < res.requested;
      toast({
        title: fa
          ? `${res.deleted} کد تخفیف حذف شد`
          : `${res.deleted} discount code${res.deleted === 1 ? "" : "s"} deleted`,
        description: short
          ? (fa
              ? `${res.requested - res.deleted} مورد از قبل حذف شده بود.`
              : `${res.requested - res.deleted} had already been removed.`)
          : undefined,
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا در حذف" : "Delete failed", description: serverMessage(err) });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Percent className="h-4 w-4" /> {fa ? "کد تخفیف جدید" : "New discount code"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="disc-code">{fa ? "کد" : "Code"}</Label>
            <Input
              id="disc-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="SUMMER20"
              className="uppercase"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{fa ? "نوع" : "Kind"}</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as DiscountKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">{fa ? "درصدی" : "Percent"}</SelectItem>
                  <SelectItem value="fixed">{fa ? "مبلغ ثابت" : "Fixed amount"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="disc-value">
                {kind === "percent" ? (fa ? "درصد (۱ تا ۱۰۰)" : "Percent (1–100)") : (fa ? "مبلغ (تومان)" : "Amount (Toman)")}
              </Label>
              <Input
                id="disc-value"
                type="number"
                inputMode="numeric"
                min={1}
                max={kind === "percent" ? 100 : undefined}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="disc-max-uses">{fa ? "سقف استفاده" : "Max uses"}</Label>
              <Input
                id="disc-max-uses"
                type="number"
                inputMode="numeric"
                min={1}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                placeholder={fa ? "نامحدود" : "Unlimited"}
              />
              <p className="text-xs text-muted-foreground">{fa ? "خالی = نامحدود" : "Empty = unlimited"}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="disc-expires">{fa ? "تاریخ انقضا" : "Expiry date"}</Label>
              <Input
                id="disc-expires"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{fa ? "خالی = بدون انقضا" : "Empty = never expires"}</p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="disc-active" className="cursor-pointer">{fa ? "فعال" : "Active"}</Label>
            <Switch id="disc-active" checked={active} onCheckedChange={setActive} />
          </div>

          <Button onClick={create} disabled={creating}>
            {creating ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Plus className="me-2 h-4 w-4" />}
            {fa ? "ساخت کد تخفیف" : "Create discount code"}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-muted-foreground">
            {fa ? "کدهای تخفیف" : "Discount codes"}
          </h3>
          {list.length > 0 && (
            <div className="flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(v) => toggleAll(v === true)}
                  disabled={deleting}
                  aria-label={fa ? "انتخاب همه" : "Select all"}
                />
                {fa ? "انتخاب همه" : "Select all"}
              </label>
              {liveSelected.length > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleting}
                  onClick={() => setBulkOpen(true)}
                >
                  {deleting ? (
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="me-2 h-4 w-4" />
                  )}
                  {fa
                    ? `حذف ${liveSelected.length} مورد`
                    : `Delete ${liveSelected.length}`}
                </Button>
              )}
            </div>
          )}
        </div>
        {isLoading ? (
          <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-md bg-muted" />)}</div>
        ) : list.length > 0 ? (
          list.map((c) => {
            const spent = isExpired(c) || isExhausted(c);
            return (
              <Card key={c.id} className={spent ? "opacity-60" : undefined}>
                <CardContent className="flex items-start justify-between gap-3 p-4">
                  <Checkbox
                    className="mt-1 shrink-0"
                    checked={selectedSet.has(c.id)}
                    onCheckedChange={(v) => toggleOne(c.id, v === true)}
                    disabled={deleting}
                    aria-label={fa ? `انتخاب ${c.code}` : `Select ${c.code}`}
                  />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-semibold">{c.code}</span>
                      <Badge variant="outline">
                        {c.kind === "percent" ? `${c.value}%` : formatToman(c.value, lang)}
                      </Badge>
                      {!c.active && <Badge variant="secondary">{fa ? "غیرفعال" : "Inactive"}</Badge>}
                      {isExpired(c) && <Badge variant="destructive">{fa ? "منقضی‌شده" : "Expired"}</Badge>}
                      {isExhausted(c) && <Badge variant="destructive">{fa ? "تمام‌شده" : "Exhausted"}</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {fa ? "استفاده‌شده" : "Used"}: {c.usedCount} / {c.maxUses ?? (fa ? "نامحدود" : "∞")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {fa ? "انقضا" : "Expires"}: {c.expiresAt
                        ? new Date(c.expiresAt).toLocaleDateString(lang === "fa" ? "fa-IR" : "en-US")
                        : (fa ? "هیچ‌وقت" : "Never")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      checked={c.active}
                      onCheckedChange={() => toggleActive(c)}
                      disabled={busyId === c.id || deleting}
                      aria-label={fa ? "فعال/غیرفعال" : "Toggle active"}
                    />
                    {/* Gated on `deleting`: without it an operator can queue
                        several deletes faster than they complete, which is
                        exactly the concurrent-rewrite path we just fixed. */}
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={deleting}
                      onClick={() => setDeleteTarget(c)}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
            {fa ? "هنوز کد تخفیفی ساخته نشده." : "No discount codes yet."}
          </p>
        )}
      </div>

      <AlertDialog open={bulkOpen} onOpenChange={(open) => !open && setBulkOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {fa ? `حذف ${liveSelected.length} کد تخفیف؟` : `Delete ${liveSelected.length} discount codes?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {fa
                ? "این کدها برای همیشه حذف می‌شوند و دیگر قابل استفاده نخواهند بود."
                : "These codes will be permanently deleted and can no longer be used."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-40 overflow-y-auto rounded-md border p-2">
            <p className="flex flex-wrap gap-1.5">
              {liveSelected.map((c) => (
                <Badge key={c.id} variant="outline" className="font-mono">{c.code}</Badge>
              ))}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmBulkDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
              {fa ? "حذف همه" : "Delete all"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fa ? "حذف کد تخفیف؟" : "Delete discount code?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {fa
                ? `کد «${deleteTarget?.code}» برای همیشه حذف می‌شود و دیگر قابل استفاده نخواهد بود.`
                : `The code "${deleteTarget?.code}" will be permanently deleted and can no longer be used.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
              {fa ? "حذف" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
