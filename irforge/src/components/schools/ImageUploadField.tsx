import { useRef, useState } from "react";
import { ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getAuthToken } from "@/lib/auth-token";
import { useT } from "@/hooks/use-translation";

/**
 * آدرسِ قابلِ‌نمایش: آپلودها نسبی‌اند (`/api/uploads/images/<id>`)؛ اگر API روی originِ دیگری است
 * (VITE_API_URL) باید پیشوند بخورند. لینک‌هایِ http(s)ِ دستیِ قدیمی دست‌نخورده برمی‌گردند.
 */
export function imageSrc(url: string | null | undefined): string {
  const u = (url ?? "").trim();
  if (u.startsWith("/api/uploads/")) return `${(import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "")}${u}`;
  return u;
}

const MAX_DIM = 1280;
const MAX_BYTES = 2.5 * 1024 * 1024;

/**
 * کوچک‌کردنِ سمتِ کلاینت: عکسِ گوشی ۴–۱۰MB است؛ تا ۱۲۸۰px و webp/jpeg می‌شود (معمولاً <۳۰۰KB).
 * GIFِ کوچک دست‌نخورده می‌رود (canvas انیمیشن را از بین می‌برد).
 */
async function prepare(file: File): Promise<Blob> {
  if (file.type === "image/gif" && file.size <= MAX_BYTES) return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const toBlob = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.85));
  // مرورگرهایی که webp را رمزگذاری نمی‌کنند بی‌صدا PNG برمی‌گردانند → به jpeg برمی‌گردیم.
  let blob = await toBlob("image/webp");
  if (!blob || blob.type !== "image/webp") blob = await toBlob("image/jpeg");
  if (!blob) throw new Error("encode");
  return blob;
}

export function uploadImageBlob(blob: Blob, onProgress: (p: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${(import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "")}/api/uploads/images`);
    const token = getAuthToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", blob.type);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onerror = () => reject(Object.assign(new Error("network"), { code: "network" }));
    xhr.onload = () => {
      let data: any = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300 && data?.url) resolve(data.url);
      else reject(Object.assign(new Error("upload"), { code: data?.code ?? String(xhr.status), status: xhr.status }));
    };
    xhr.send(blob);
  });
}

/**
 * ImageUploadField — انتخابِ عکس (دوربین/گالریِ گوشی)، کوچک‌سازی، آپلود و پیش‌نمایش. مقدارش همان رشته‌یِ URL است،
 * پس ستون‌هایِ دیتابیس (`photoUrl`/`imageUrl`) عوض نمی‌شوند و لینک‌هایِ دستیِ قدیمی همچنان نمایش داده می‌شوند.
 */
export function ImageUploadField({
  value, onChange, size = "md", disabled, testId = "image-upload",
}: {
  value: string;
  onChange: (url: string) => void;
  size?: "sm" | "md";
  disabled?: boolean;
  testId?: string;
}) {
  const t = useT("schools") as any;
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const box = size === "sm" ? "h-12 w-12" : "h-20 w-20";

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) { setError(t.imageUploadNotImage); return; }
    setBusy(true); setProgress(0);
    try {
      const blob = await prepare(file);
      if (blob.size > MAX_BYTES) { setError(t.imageUploadTooLarge); return; }
      const url = await uploadImageBlob(blob, setProgress);
      onChange(url);
    } catch (err: any) {
      setError(
        err?.status === 413 || err?.code === "image_too_large" ? t.imageUploadTooLarge
        : err?.status === 415 ? t.imageUploadNotImage
        : err?.status === 429 ? t.imageUploadRateLimited
        : err?.code === "network" ? t.imageUploadNetworkError
        : t.imageUploadFailed,
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = ""; // انتخابِ دوبارهِ همان فایل هم change بدهد
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <div className="flex items-center gap-3">
        <div className={`flex ${box} shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted`}>
          {value.trim() ? (
            <img src={imageSrc(value)} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.visibility = "hidden")} onLoad={(e) => (e.currentTarget.style.visibility = "visible")} />
          ) : (
            <ImageIcon className="size-6 text-muted-foreground" />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* accept="image/*": گوشی «دوربین / گالری» را پیشنهاد می‌دهد */}
          <input ref={inputRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => void handleFile(e.target.files?.[0])} data-testid={`${testId}-input`} />
          <Button type="button" variant="outline" size="sm" className="min-h-10" disabled={disabled || busy} onClick={() => inputRef.current?.click()}>
            {busy ? <Loader2 className="me-1 size-4 animate-spin" /> : <Upload className="me-1 size-4" />}
            {value.trim() ? t.imageUploadReplace : t.imageUploadChoose}
          </Button>
          {value.trim() && !busy && (
            <Button type="button" variant="ghost" size="sm" className="min-h-10 text-destructive hover:bg-destructive/10" disabled={disabled} onClick={() => { setError(null); onChange(""); }}>
              <Trash2 className="me-1 size-4" /> {t.imageUploadRemove}
            </Button>
          )}
        </div>
      </div>
      {busy && <Progress value={progress} className="h-1.5" aria-label={t.imageUploadUploading} />}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}
