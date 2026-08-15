import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { UpdateBlockEditor, MAX_BLOCKS, newImageBlock } from "@/components/admin/UpdateBlockEditor";
import { UpdateBlocks, type UpdateBlock } from "@/components/updates/UpdateBlocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Sparkles, Trash2, Loader2, Plus,
  AlertTriangle, RefreshCw, Send, Pencil, Copy,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";

/** کلید کوئری لیست ادمین — admin.tsx برای refresh دستی هم از همین استفاده می‌کند. */
export const ADMIN_UPDATES_KEY = ["admin-updates"] as const;

/**
 * سقف‌ها باید با اعتبارسنجی سرور (`api-server/src/routes/updates.ts`) یکی
 * باشند، وگرنه کاربر یک ۴۰۰ می‌گیرد که فرم اصلاً جلویش را نگرفته بود.
 */
const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 800 * 1024;
const MAX_EDGE = 1400;

type AdminUpdate = {
  id: string;
  version: string | null;
  title: string;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  blockCount: number;
};

type UpdateDetail = AdminUpdate & { blocks: UpdateBlock[] };

/** پیش‌نویسِ در حال نوشتن، کلیدشده با id آپدیت (یا "new"). */
const DRAFT_PREFIX = "irforge_update_draft:";
type Draft = { version: string; title: string; blocks: UpdateBlock[] };

function serverMessage(err: any): string | undefined {
  const reason = err?.data?.error;
  return typeof reason === "string" && reason.trim() !== "" ? reason : err?.message;
}

/** حجم تقریبیِ دیکدشده‌ی یک data-URL، بدون دیکد واقعی. */
function dataUrlBytes(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(";base64,") + 8);
  return Math.floor((b64.length * 3) / 4);
}

/**
 * عکس را سمت کلاینت فشرده می‌کند: بزرگ‌ترین ضلع به ۱۴۰۰px، خروجی JPEG با
 * کیفیت ۰٫۸ و اگر لازم شد پله‌ای پایین‌تر. PNG شفاف PNG می‌ماند (تبدیلش به
 * JPEG پس‌زمینه‌ی سیاه می‌دهد).
 *
 * دلیل وجودش: بادی اکسپرس سقف 10mb دارد و عکس‌ها به‌صورت base64 (~۱٫۳۳ برابر)
 * منتقل می‌شوند؛ بدون فشرده‌سازی، دو عکس گوشی همین سقف را رد می‌کنند و کاربر
 * یک ۴۱۳ بی‌توضیح می‌گیرد.
 */
async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  // اول WebP: هم از JPEG هم‌کیفیت کوچک‌تر است و هم — برخلاف JPEG — شفافیت را
  // نگه می‌دارد، پس همان مسیر PNG شفاف را هم پوشش می‌دهد. مرورگری که WebP
  // انکود نمی‌کند بی‌سروصدا PNG برمی‌گرداند، و همان چک `startsWith` جلویش را
  // می‌گیرد تا به مسیرهای قدیمی برسیم.
  for (const quality of [0.85, 0.75, 0.65]) {
    const out = canvas.toDataURL("image/webp", quality);
    if (out.startsWith("data:image/webp") && dataUrlBytes(out) <= MAX_IMAGE_BYTES) return out;
  }

  const isPng = file.type === "image/png";
  if (isPng) {
    const out = canvas.toDataURL("image/png");
    if (dataUrlBytes(out) <= MAX_IMAGE_BYTES) return out;
    // PNG بزرگ را به JPEG برمی‌گردانیم؛ شفافیت را از دست می‌دهد ولی از
    // «اصلاً قابل آپلود نیست» بهتر است.
  }
  for (const quality of [0.8, 0.7, 0.6, 0.5]) {
    const out = canvas.toDataURL("image/jpeg", quality);
    if (dataUrlBytes(out) <= MAX_IMAGE_BYTES) return out;
  }
  throw new Error("too-large");
}

export function UpdatesManager() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("");
  const [blocks, setBlocks] = useState<UpdateBlock[]>([]);
  const [busyImages, setBusyImages] = useState(false);
  /** تا وقتی پیش‌نویسِ ذخیره‌شده بازیابی نشده، روی آن نمی‌نویسیم. */
  const restored = useRef(false);

  const draftKey = DRAFT_PREFIX + (editingId ?? "new");

  // ── بازیابی پیش‌نویس ──────────────────────────────────────────────────
  // نوشتن یک آپدیت پنج‌بلوکی و از دست دادنش با یک رفرش اتفاقی، محتمل‌ترین
  // راهی است که این قابلیت می‌تواند روز کسی را خراب کند.
  useEffect(() => {
    restored.current = false;
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw) as Draft;
        if (Array.isArray(d.blocks)) {
          setVersion(d.version ?? "");
          setTitle(d.title ?? "");
          setBlocks(d.blocks);
        }
      }
    } catch { /* پیش‌نویس خراب — نادیده */ }
    restored.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // ── ذخیره‌ی خودکار ────────────────────────────────────────────────────
  useEffect(() => {
    if (!restored.current) return;
    try {
      if (title.trim() === "" && blocks.length === 0) sessionStorage.removeItem(draftKey);
      else sessionStorage.setItem(draftKey, JSON.stringify({ version, title, blocks }));
    } catch { /* حافظه پر — بی‌خیال */ }
  }, [draftKey, version, title, blocks]);

  const { data: items, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ADMIN_UPDATES_KEY,
    queryFn: () => customFetch<AdminUpdate[]>("/api/admin/updates"),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ADMIN_UPDATES_KEY });
    queryClient.invalidateQueries({ queryKey: ["update-unseen"] });
    queryClient.invalidateQueries({ queryKey: ["updates"] });
  };

  function resetForm() {
    try { sessionStorage.removeItem(draftKey); } catch { /* ignore */ }
    setEditingId(null);
    setVersion(""); setTitle(""); setBlocks([]);
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        version: version.trim() || null,
        title: title.trim(),
        blocks,
      };
      return editingId
        ? customFetch<AdminUpdate>(`/api/admin/updates/${editingId}`, {
            method: "PATCH", body: JSON.stringify(payload),
          })
        : customFetch<AdminUpdate>("/api/admin/updates", {
            method: "POST", body: JSON.stringify(payload),
          });
    },
    onSuccess: () => {
      invalidate();
      resetForm();
      toast({ title: fa ? "پیش‌نویس ذخیره شد" : "Draft saved" });
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: serverMessage(err) }),
  });

  const publish = useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/admin/updates/${id}/publish`, { method: "POST" }),
    onSuccess: () => {
      invalidate();
      toast({ title: fa ? "آپدیت منتشر شد" : "Update published" });
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: serverMessage(err) }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => customFetch(`/api/admin/updates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast({ title: fa ? "آپدیت حذف شد" : "Update deleted" });
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: serverMessage(err) }),
  });

  async function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setBusyImages(true);
    const accepted: string[] = [];
    for (const file of Array.from(list)) {
      if (blocks.length + accepted.length >= MAX_BLOCKS) break;
      try {
        accepted.push(await compressImage(file));
      } catch {
        toast({
          variant: "destructive",
          title: fa ? "عکس بیش از حد بزرگ است" : "Image too large",
          description: fa
            ? `«${file.name}» حتی بعد از فشرده‌سازی از ۸۰۰ کیلوبایت بیشتر است.`
            : `"${file.name}" is still over 800KB after compression.`,
        });
      }
    }
    // هر عکس یک بلوک تازه در انتهای دنباله می‌شود؛ جابه‌جایی کار ادیتور است.
    setBlocks((prev) => [...prev, ...accepted.map(newImageBlock)].slice(0, MAX_BLOCKS));
    setBusyImages(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function startEdit(u: AdminUpdate) {
    try {
      // فرم به بدنه‌ی عکس‌ها نیاز دارد و لیست ادمین عمداً آن‌ها را حمل نمی‌کند،
      // پس جزئیات را جدا می‌گیریم.
      const detail = await customFetch<UpdateDetail>(`/api/updates/${u.id}`);
      setEditingId(u.id);
      setVersion(detail.version ?? "");
      setTitle(detail.title);
      setBlocks(detail.blocks ?? []);
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: serverMessage(err) });
    }
  }

  function submit() {
    if (!title.trim()) {
      toast({ variant: "destructive", title: fa ? "عنوان الزامی است" : "A title is required" });
      return;
    }
    if (blocks.length === 0) {
      toast({ variant: "destructive", title: fa ? "حداقل یک بلوک لازم است" : "At least one block is required" });
      return;
    }
    if (blocks.some((b) => b.type === "text" && b.content.trim() === "")) {
      toast({ variant: "destructive", title: fa ? "یک بلوک متن خالی است" : "A text block is empty" });
      return;
    }
    // alt اجباری است و سرور هم ردش می‌کند؛ اینجا جلویش گرفته می‌شود تا کاربر
    // یک ۴۰۰ مبهم نگیرد.
    if (blocks.some((b) => b.type === "image" && b.alt.trim() === "")) {
      toast({
        variant: "destructive",
        title: fa ? "هر عکس به متن جایگزین نیاز دارد" : "Every image needs alt text",
        description: fa
          ? "بدون آن، کاربرِ screen reader از عکس چیزی نمی‌فهمد."
          : "Without it, screen-reader users get nothing from the image.",
      });
      return;
    }
    save.mutate();
  }

  /** کپی‌کردن یک آپدیت به‌عنوان پیش‌نویس تازه — بیشتر آپدیت‌ها ساختار قبلی را دارند. */
  async function duplicate(u: AdminUpdate) {
    try {
      const detail = await customFetch<UpdateDetail>(`/api/updates/${u.id}`);
      setEditingId(null);
      setVersion(detail.version ?? "");
      setTitle((fa ? "رونوشت — " : "Copy — ") + detail.title);
      // idهای تازه، وگرنه دو بلوک در دو آپدیت یک id می‌گرفتند.
      setBlocks((detail.blocks ?? []).map((b) => ({ ...b, id: crypto.randomUUID() })));
      toast({ title: fa ? "به‌عنوان پیش‌نویس تازه کپی شد" : "Copied as a new draft" });
    } catch (err) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: serverMessage(err) });
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            {editingId
              ? (fa ? "ویرایش آپدیت" : "Edit update")
              : (fa ? "آپدیت جدید" : "New update")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="upd-version">{fa ? "نسخه (اختیاری)" : "Version (optional)"}</Label>
            <Input
              id="upd-version" value={version} placeholder="v1.4"
              onChange={(e) => setVersion(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="upd-title">{fa ? "عنوان" : "Title"}</Label>
            <Input id="upd-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{fa ? "بدنه" : "Body"}</Label>
            <p className="text-xs text-muted-foreground">
              {fa
                ? "متن و عکس، با هر ترتیبی. برای جابه‌جایی بکشید یا از دکمه‌های بالا/پایین استفاده کنید."
                : "Text and images, in any order. Drag to reorder, or use the up/down buttons."}
            </p>
            <input
              ref={fileInput} type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => onFiles(e.target.files)}
            />
            <UpdateBlockEditor
              blocks={blocks}
              onChange={setBlocks}
              onPickImages={() => fileInput.current?.click()}
              busyImages={busyImages}
              disabled={save.isPending}
            />
          </div>

          {/* پیش‌نمایش زنده — تفاوت بین ادیتوری که کار می‌کند و ادیتوری که
              اول منتشر می‌کنی و بعد می‌فهمی چه شکلی شده. روی موبایل زیر
              ادیتور می‌آید، روی دسکتاپ کنارش (شبکه‌ی والد). */}
          {blocks.length > 0 && (
            <div className="space-y-2">
              <Label>{fa ? "پیش‌نمایش" : "Preview"}</Label>
              <div className="rounded-lg border bg-muted/30 p-4">
                <h4 className="mb-3 text-lg font-bold">{title || (fa ? "بدون عنوان" : "Untitled")}</h4>
                <UpdateBlocks blocks={blocks} size="compact" />
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={submit} disabled={save.isPending}>
              {save.isPending
                ? <Loader2 className="me-2 h-4 w-4 animate-spin" />
                : <Plus className="me-2 h-4 w-4" />}
              {fa ? "ذخیره‌ی پیش‌نویس" : "Save draft"}
            </Button>
            {editingId && (
              <Button variant="ghost" onClick={resetForm}>{fa ? "انصراف" : "Cancel"}</Button>
            )}
          </div>
          {/* انتشار عمداً اینجا نیست: از لیست انجام می‌شود، با تأیید. ذخیره
              نباید عارضه‌ی جانبیِ فرستادن اعلان به همه‌ی کاربرها داشته باشد. */}
          <p className="text-xs text-muted-foreground">
            {fa
              ? "ذخیره فقط پیش‌نویس می‌سازد. انتشار از فهرست کنار انجام می‌شود."
              : "Saving only creates a draft. Publish from the list beside this form."}
          </p>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">
          {fa ? "آپدیت‌ها" : "Updates"}
        </h3>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-md bg-muted" />)}
          </div>
        ) : isError ? (
          // درس فاز ۲: بدون این شاخه، یک ۵۰۰ فقط به‌صورت skeleton بی‌پایان دیده می‌شود.
          <Card className="border-red-500/40 bg-red-500/5">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-red-500">
                    {fa ? "خطا در بارگذاری آپدیت‌ها" : "Failed to load updates"}
                  </p>
                  <p className="break-words text-xs text-muted-foreground">
                    {serverMessage(error) ?? (fa ? "خطای ناشناخته" : "Unknown error")}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                {isFetching
                  ? <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  : <RefreshCw className="me-2 h-4 w-4" />}
                {fa ? "تلاش دوباره" : "Try again"}
              </Button>
            </CardContent>
          </Card>
        ) : items && items.length > 0 ? (
          items.map((u) => (
            <Card key={u.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={u.published ? "default" : "outline"}>
                    {u.published ? (fa ? "منتشرشده" : "Published") : (fa ? "پیش‌نویس" : "Draft")}
                  </Badge>
                  {u.version && <Badge variant="secondary">{u.version}</Badge>}
                  <span className="min-w-0 truncate font-medium">{u.title}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {fa ? `${u.blockCount} بلوک` : `${u.blockCount} block(s)`}
                  {" · "}
                  {new Date(u.publishedAt ?? u.createdAt).toLocaleDateString(fa ? "fa-IR" : "en-US")}
                </p>

                <div className="flex flex-wrap gap-2">
                  {!u.published && (
                    <>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" disabled={publish.isPending}>
                            <Send className="me-2 h-4 w-4" />
                            {fa ? "انتشار" : "Publish"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{fa ? "انتشار آپدیت؟" : "Publish update?"}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {fa
                                ? "بعد از انتشار، این آپدیت برای همه‌ی کاربران اعلان می‌سازد و قابل بازگشت نیست."
                                : "Once published, this update sends a notification to every user and cannot be undone."}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
                            <AlertDialogAction onClick={() => publish.mutate(u.id)}>
                              {fa ? "انتشار" : "Publish"}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>

                      <Button size="sm" variant="outline" onClick={() => startEdit(u)}>
                        <Pencil className="me-2 h-4 w-4" />
                        {fa ? "ویرایش" : "Edit"}
                      </Button>
                    </>
                  )}

                  {/* رونوشت برای منتشرشده‌ها هم هست: بیشتر آپدیت‌ها از نظر
                      ساختار کپی آپدیت قبلی‌اند، و کپی‌کردن از نو ساختن بهتر است. */}
                  <Button size="sm" variant="outline" onClick={() => duplicate(u)}>
                    <Copy className="me-2 h-4 w-4" />
                    {fa ? "رونوشت" : "Duplicate"}
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" disabled={remove.isPending}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{fa ? "حذف آپدیت؟" : "Delete update?"}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {fa
                            ? "آپدیت، عکس‌هایش و سابقه‌ی دیده‌شدنش حذف می‌شوند. اعلان‌هایی که قبلاً ساخته شده‌اند باقی می‌مانند."
                            : "The update, its images and its seen history are removed. Notifications already sent stay."}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove.mutate(u.id)}>
                          {fa ? "حذف" : "Delete"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
            {fa ? "هنوز آپدیتی ساخته نشده." : "No updates yet."}
          </p>
        )}
      </div>
    </div>
  );
}
