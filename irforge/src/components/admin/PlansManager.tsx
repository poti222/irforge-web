import { useState } from "react";
import { customFetch, getListPlansQueryKey } from "@workspace/api-client-react";
import type { Plan } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";

// Exported so the admin panel's header RefreshButton (Phase 13) can watch/
// invalidate this tab's data without duplicating the key.
export const ADMIN_PLANS_KEY = ["admin-plans"] as const;

type FormState = {
  id: string | null;
  name: string;
  price: string;
  interval: "monthly" | "yearly";
  featuresText: string;
  maxBots: string;
  maxPlugins: string;
  maxUsers: string;
  ramGb: string;
  cpuCores: string;
  popular: boolean;
};

const EMPTY: FormState = {
  id: null, name: "", price: "0", interval: "monthly",
  featuresText: "", maxBots: "1", maxPlugins: "5", maxUsers: "100",
  ramGb: "1", cpuCores: "1", popular: false,
};

export function PlansManager() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: plans, isLoading } = useQuery({
    queryKey: ADMIN_PLANS_KEY,
    queryFn: () => customFetch<Plan[]>("/api/admin/plans"),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [deleting, setDeleting] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ADMIN_PLANS_KEY });
    // keep the public /plans page in sync
    queryClient.invalidateQueries({ queryKey: getListPlansQueryKey() });
  };

  function openCreate() { setForm(EMPTY); setDialogOpen(true); }
  function openEdit(p: Plan) {
    setForm({
      id: p.id, name: p.name, price: String(p.price), interval: p.interval,
      featuresText: (p.features ?? []).join("\n"),
      maxBots: String(p.maxBots), maxPlugins: String(p.maxPlugins),
      maxUsers: String(p.maxUsers ?? 100),
      ramGb: String(p.ramGb ?? 1), cpuCores: String(p.cpuCores ?? 1),
      popular: !!p.popular,
    });
    setDialogOpen(true);
  }

  async function save() {
    if (!form.name.trim()) {
      toast({ variant: "destructive", title: fa ? "نام پلن الزامی است" : "Plan name is required" });
      return;
    }
    const body = {
      name: form.name.trim(),
      price: Number(form.price) || 0,
      interval: form.interval,
      features: form.featuresText.split("\n").map((s) => s.trim()).filter(Boolean),
      maxBots: Number(form.maxBots) || 0,
      maxPlugins: Number(form.maxPlugins) || 0,
      maxUsers: Number(form.maxUsers) || 0,
      // No ceiling here on purpose: an admin may size a bespoke plan at 24 GB.
      // The 8 GB cap in bot-tiers.ts applies only to the self-serve builder.
      ramGb: Number(form.ramGb) || 0,
      cpuCores: Number(form.cpuCores) || 0,
      popular: form.popular,
    };
    setBusy(true);
    try {
      if (form.id) {
        await customFetch(`/api/admin/plans/${form.id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await customFetch("/api/admin/plans", { method: "POST", body: JSON.stringify(body) });
      }
      invalidate();
      setDialogOpen(false);
      toast({ title: form.id ? (fa ? "پلن به‌روزرسانی شد" : "Plan updated") : (fa ? "پلن ساخته شد" : "Plan created") });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await customFetch(`/api/admin/plans/${deleting.id}`, { method: "DELETE" });
      invalidate();
      setDeleting(null);
      toast({ title: fa ? "پلن حذف شد" : "Plan deleted" });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-lg font-semibold">{fa ? "مدیریت پلن‌ها" : "Plan management"}</h3>
        <Button size="sm" onClick={openCreate} className="w-full sm:w-auto"><Plus className="me-2 h-4 w-4" /> {fa ? "پلن جدید" : "New plan"}</Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />)}</div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{fa ? "نام" : "Name"}</TableHead>
                <TableHead>{fa ? "قیمت" : "Price"}</TableHead>
                <TableHead className="hidden md:table-cell">{fa ? "دوره" : "Interval"}</TableHead>
                <TableHead className="hidden lg:table-cell">{fa ? "بات/پلاگین" : "Bots/Plugins"}</TableHead>
                <TableHead>{fa ? "محبوب" : "Popular"}</TableHead>
                <TableHead className="text-end">{fa ? "عملیات" : "Actions"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(plans ?? []).map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{p.price === 0 ? (fa ? "رایگان" : "Free") : formatToman(p.price, lang)}</TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">{p.interval}</TableCell>
                  <TableCell className="hidden lg:table-cell text-muted-foreground">{p.maxBots} / {p.maxPlugins}</TableCell>
                  <TableCell>{p.popular ? <Badge>{fa ? "بله" : "yes"}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-end">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleting(p)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? (fa ? "ویرایش پلن" : "Edit plan") : (fa ? "پلن جدید" : "New plan")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-1 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{fa ? "نام" : "Name"}</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{fa ? "قیمت (تومان)" : "Price (Toman)"}</Label>
              <Input type="number" dir="ltr" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{fa ? "دوره" : "Interval"}</Label>
              <Select value={form.interval} onValueChange={(v) => setForm({ ...form, interval: v as "monthly" | "yearly" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">monthly</SelectItem>
                  <SelectItem value="yearly">yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>{fa ? "حداکثر بات" : "Max bots"}</Label><Input type="number" dir="ltr" value={form.maxBots} onChange={(e) => setForm({ ...form, maxBots: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>{fa ? "حداکثر پلاگین" : "Max plugins"}</Label><Input type="number" dir="ltr" value={form.maxPlugins} onChange={(e) => setForm({ ...form, maxPlugins: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>{fa ? "حداکثر کاربر" : "Max users"}</Label><Input type="number" dir="ltr" value={form.maxUsers} onChange={(e) => setForm({ ...form, maxUsers: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>{fa ? "رم (گیگابایت)" : "RAM (GB)"}</Label><Input type="number" min="0" step="0.5" dir="ltr" value={form.ramGb} onChange={(e) => setForm({ ...form, ramGb: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>{fa ? "پردازنده (هسته)" : "CPU (cores)"}</Label><Input type="number" min="0" step="0.5" dir="ltr" value={form.cpuCores} onChange={(e) => setForm({ ...form, cpuCores: e.target.value })} /></div>
            <div className="flex items-end gap-2 pb-1">
              <Switch checked={form.popular} onCheckedChange={(v) => setForm({ ...form, popular: v })} id="plan-popular" />
              <Label htmlFor="plan-popular">{fa ? "محبوب" : "Popular"}</Label>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{fa ? "ویژگی‌ها (هر خط یک مورد)" : "Features (one per line)"}</Label>
              <textarea
                className="min-h-[80px] w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                value={form.featuresText}
                onChange={(e) => setForm({ ...form, featuresText: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>{fa ? "انصراف" : "Cancel"}</Button>
            <Button onClick={save} disabled={busy}>{busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{fa ? "ذخیره" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fa ? "حذف پلن؟" : "Delete plan?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {fa ? `پلن «${deleting?.name}» حذف می‌شود.` : `“${deleting?.name}” will be deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmDelete(); }} disabled={busy} className="bg-red-600 hover:bg-red-700">
              {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{fa ? "حذف" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
