import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
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
  Sparkles, Trash2, Loader2, Plus, ImagePlus, X, ChevronLeft, ChevronRight,
  AlertTriangle, RefreshCw, Send, Pencil,
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
  body: string;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  imageCount: number;
};

type UpdateDetail = AdminUpdate & { images: string[] };

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
  const [body, setBody] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [busyImages, setBusyImages] = useState(false);

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
    setEditingId(null);
    setVersion(""); setTitle(""); setBody(""); setImages([]);
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        version: version.trim() || null,
        title: title.trim(),
        body: body.trim(),
        images,
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
      if (images.length + accepted.length >= MAX_IMAGES) break;
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
    setImages((prev) => [...prev, ...accepted].slice(0, MAX_IMAGES));
    setBusyImages(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  function moveImage(index: number, delta: number) {
    setImages((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function startEdit(u: AdminUpdate) {
    try {
      // فرم به بدنه‌ی عکس‌ها نیاز دارد و لیست ادمین عمداً آن‌ها را حمل نمی‌کند،
      // پس جزئیات را جدا می‌گیریم.
      const detail = await customFetch<UpdateDetail>(`/api/updates/${u.id}`);
      setEditingId(u.id);
      setVersion(detail.version ?? "");
      setTitle(detail.title);
      setBody(detail.body);
      setImages(detail.images ?? []);
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: serverMessage(err) });
    }
  }

  function submit() {
    if (!title.trim() || !body.trim()) {
      toast({
        variant: "destructive",
        title: fa ? "عنوان و متن الزامی است" : "Title and body are required",
      });
      return;
    }
    save.mutate();
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
          <div className="space-y-1.5">
            <Label htmlFor="upd-body">{fa ? "متن" : "Body"}</Label>
            <Textarea id="upd-body" rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>{fa ? `عکس‌ها (${images.length}/${MAX_IMAGES})` : `Images (${images.length}/${MAX_IMAGES})`}</Label>
            <input
              ref={fileInput} type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => onFiles(e.target.files)}
            />
            <Button
              type="button" variant="outline" size="sm"
              disabled={busyImages || images.length >= MAX_IMAGES}
              onClick={() => fileInput.current?.click()}
            >
              {busyImages
                ? <Loader2 className="me-2 h-4 w-4 animate-spin" />
                : <ImagePlus className="me-2 h-4 w-4" />}
              {fa ? "افزودن عکس" : "Add images"}
            </Button>

            {images.length > 0 && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {images.map((src, i) => (
                  <div key={i} className="group relative overflow-hidden rounded-md border">
                    <img
                      src={src} alt={fa ? `پیش‌نمایش ${i + 1}` : `Preview ${i + 1}`}
                      className="h-20 w-full object-cover"
                    />
                    <div className="absolute inset-x-0 bottom-0 flex justify-between bg-background/80 p-0.5">
                      <button
                        type="button" className="rounded p-0.5 hover:bg-muted"
                        onClick={() => moveImage(i, -1)} disabled={i === 0}
                        aria-label={fa ? "جابه‌جایی به قبل" : "Move earlier"}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button" className="rounded p-0.5 hover:bg-muted"
                        onClick={() => setImages((p) => p.filter((_, j) => j !== i))}
                        aria-label={fa ? "حذف عکس" : "Remove image"}
                      >
                        <X className="h-3.5 w-3.5 text-red-500" />
                      </button>
                      <button
                        type="button" className="rounded p-0.5 hover:bg-muted"
                        onClick={() => moveImage(i, 1)} disabled={i === images.length - 1}
                        aria-label={fa ? "جابه‌جایی به بعد" : "Move later"}
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2">
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
                  {fa ? `${u.imageCount} عکس` : `${u.imageCount} image(s)`}
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
