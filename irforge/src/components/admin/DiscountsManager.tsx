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
  const [deleting, setDeleting] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

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
      await customFetch(`/api/admin/discounts/${deleteTarget.id}`, { method: "DELETE" });
      invalidate();
      toast({ title: fa ? "کد تخفیف حذف شد" : "Discount code deleted" });
      setDeleteTarget(null);
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
        <h3 className="text-sm font-semibold text-muted-foreground">
          {fa ? "کدهای تخفیف" : "Discount codes"}
        </h3>
        {isLoading ? (
          <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-md bg-muted" />)}</div>
        ) : codes && codes.length > 0 ? (
          codes.map((c) => {
            const spent = isExpired(c) || isExhausted(c);
            return (
              <Card key={c.id} className={spent ? "opacity-60" : undefined}>
                <CardContent className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0 space-y-1.5">
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
                      disabled={busyId === c.id}
                      aria-label={fa ? "فعال/غیرفعال" : "Toggle active"}
                    />
                    <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(c)}>
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
