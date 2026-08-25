/**
 * PluginReleaseNotesManager.tsx — IRFORGE_PROMPT_V3 Phase 38.
 *
 * changelog per-plugin، جدا از `UpdatesManager.tsx` (که یک جریانِ سراسریِ
 * اعلامیه است، نه چیزی گره‌خورده به یک پلاگینِ خاص). ساده و متنی — بلوکِ
 * عکس/چیدمان لازم نیست، فقط عنوان و شرح.
 *
 * فهرستِ پلاگین‌ها برای انتخابگر از `GET /api/plugin-licences` می‌آید (همان
 * چیزی که صفحه‌ی مارکت‌پلیس خودش استفاده می‌کند) — فقط `id`/`name`/`name_fa`ی
 * کاتالوگ لازم است، نه فیلدهای مالکیتِ حساب.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { pluginName } from "@/lib/plugin-text";

export const ADMIN_PLUGIN_RELEASE_NOTES_KEY = ["admin-plugin-release-notes"] as const;

type ReleaseNote = {
  id: string;
  pluginId: string;
  pluginName: string;
  version: string;
  title: string;
  body: string;
  createdAt: string;
};

type CatalogPlugin = { id: string; name: string; name_fa: string };

type FormState = { id: string | null; pluginId: string; version: string; title: string; body: string };
const EMPTY: FormState = { id: null, pluginId: "", version: "", title: "", body: "" };

function serverMessage(err: any): string | undefined {
  const reason = err?.data?.error;
  return typeof reason === "string" && reason.trim() !== "" ? reason : err?.message;
}

export function PluginReleaseNotesManager() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: notes, isLoading } = useQuery({
    queryKey: ADMIN_PLUGIN_RELEASE_NOTES_KEY,
    queryFn: () => customFetch<ReleaseNote[]>("/api/admin/plugin-release-notes"),
  });
  const { data: catalog } = useQuery({
    queryKey: ["plugin-catalog-for-release-notes"],
    queryFn: () => customFetch<{ plugins: CatalogPlugin[] }>("/api/plugin-licences"),
  });
  const plugins = catalog?.plugins ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [deleting, setDeleting] = useState<ReleaseNote | null>(null);
  const [busy, setBusy] = useState(false);

  function openCreate() { setForm(EMPTY); setDialogOpen(true); }
  function openEdit(n: ReleaseNote) {
    setForm({ id: n.id, pluginId: n.pluginId, version: n.version, title: n.title, body: n.body });
    setDialogOpen(true);
  }

  async function save() {
    if (!form.pluginId) {
      toast({ variant: "destructive", title: fa ? "پلاگین را انتخاب کنید" : "Choose a plugin" });
      return;
    }
    if (!form.version.trim() || !form.title.trim() || !form.body.trim()) {
      toast({ variant: "destructive", title: fa ? "نسخه، عنوان و شرح الزامی‌اند" : "Version, title and body are required" });
      return;
    }
    setBusy(true);
    try {
      if (form.id) {
        await customFetch(`/api/admin/plugin-release-notes/${form.id}`, {
          method: "PATCH",
          body: JSON.stringify({ version: form.version.trim(), title: form.title.trim(), body: form.body.trim() }),
        });
      } else {
        await customFetch("/api/admin/plugin-release-notes", {
          method: "POST",
          body: JSON.stringify({
            pluginId: form.pluginId,
            version: form.version.trim(),
            title: form.title.trim(),
            body: form.body.trim(),
          }),
        });
      }
      queryClient.invalidateQueries({ queryKey: ADMIN_PLUGIN_RELEASE_NOTES_KEY });
      setDialogOpen(false);
      toast({ title: form.id ? (fa ? "ذخیره شد" : "Saved") : (fa ? "منتشر شد و مالکان آن پلاگین مطلع شدند" : "Published — plugin owners were notified") });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: serverMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await customFetch(`/api/admin/plugin-release-notes/${deleting.id}`, { method: "DELETE" });
      queryClient.invalidateQueries({ queryKey: ADMIN_PLUGIN_RELEASE_NOTES_KEY });
      setDeleting(null);
      toast({ title: fa ? "حذف شد" : "Deleted" });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: serverMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-lg font-semibold">{fa ? "یادداشت‌های انتشارِ پلاگین" : "Plugin release notes"}</h3>
        <Button size="sm" onClick={openCreate} className="w-full sm:w-auto">
          <Plus className="me-2 h-4 w-4" /> {fa ? "یادداشتِ تازه" : "New note"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {fa
          ? "انتشارِ یک یادداشتِ تازه به هر کاربری که این پلاگین را روی حداقل یک بات نصب دارد اطلاع می‌دهد."
          : "Publishing a new note notifies every user who has this plugin installed on at least one bot."}
      </p>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />)}</div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{fa ? "پلاگین" : "Plugin"}</TableHead>
                <TableHead>{fa ? "نسخه" : "Version"}</TableHead>
                <TableHead>{fa ? "عنوان" : "Title"}</TableHead>
                <TableHead className="hidden md:table-cell">{fa ? "تاریخ" : "Date"}</TableHead>
                <TableHead className="text-end">{fa ? "عملیات" : "Actions"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(notes ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  {fa ? "هنوز یادداشتی نیست." : "No release notes yet."}
                </TableCell></TableRow>
              ) : (notes ?? []).map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="font-medium">{n.pluginName}</TableCell>
                  <TableCell><Badge variant="outline" dir="ltr">v{n.version}</Badge></TableCell>
                  <TableCell className="max-w-[16rem] truncate">{n.title}</TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {new Date(n.createdAt).toLocaleDateString(fa ? "fa-IR" : "en-US")}
                  </TableCell>
                  <TableCell className="text-end">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(n)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleting(n)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
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
            <DialogTitle>{form.id ? (fa ? "ویرایش یادداشت" : "Edit release note") : (fa ? "یادداشتِ تازه" : "New release note")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="space-y-1.5">
              <Label>{fa ? "پلاگین" : "Plugin"}</Label>
              <Select value={form.pluginId} onValueChange={(v) => setForm({ ...form, pluginId: v })} disabled={!!form.id}>
                <SelectTrigger><SelectValue placeholder={fa ? "انتخاب پلاگین" : "Choose a plugin"} /></SelectTrigger>
                <SelectContent>
                  {plugins.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{pluginName(p, lang, p.id)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{fa ? "نسخه" : "Version"}</Label>
              <Input dir="ltr" placeholder="1.2.0" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{fa ? "عنوان" : "Title"}</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{fa ? "شرح" : "Body"}</Label>
              <Textarea rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>{fa ? "انصراف" : "Cancel"}</Button>
            <Button onClick={save} disabled={busy}>
              {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {form.id ? (fa ? "ذخیره" : "Save") : (fa ? "انتشار" : "Publish")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fa ? "حذف یادداشت؟" : "Delete this note?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {fa ? `یادداشتِ «${deleting?.title}» حذف می‌شود.` : `"${deleting?.title}" will be deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmDelete(); }} disabled={busy} className="bg-red-600 hover:bg-red-700">
              {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {fa ? "حذف" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
