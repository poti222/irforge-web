/**
 * MediaList.tsx — مدیریت مدیای پنل به‌صورت **لیست** (باگ B2).
 *
 * در بات، ویرایش مدیا روی یک پنل carousel کل `media_ids` را با تک فایل جدید
 * جایگزین می‌کند (`fsm_edit_media`: `media_ids=[fid]`) و کل کاروسل نابود
 * می‌شود. اینجا هر مدیا جداگانه اضافه/حذف/جابه‌جا می‌شود و هیچ عملیاتی کل لیست
 * را replace نمی‌کند.
 *
 * **آپلود، مسیر اصلی است.** قبلاً کاربر باید `file_id` تلگرام را دستی وارد
 * می‌کرد — چیزی که برای گرفتنش باید فایل را به بات می‌فرستاد و از خروجی
 * دیباگ کپی می‌کرد. حالا فایل با کشیدن‌ورهاکردن یا کلیک آپلود می‌شود و
 * سرور خودش `file_id` را می‌گیرد. ورودی دستی هنوز هست، ولی پشت یک بخش
 * «پیشرفته» — چون آپلود به توکن بات و یک چت مقصد وابسته است و ممکن است روی
 * یک بات خاص کار نکند.
 *
 * فقط **تصویر و صوت**: ویدیو و فایل عمومی سمت سرور هم رد می‌شوند
 * (`api-server/src/routes/botMedia.ts`).
 */
import { useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import {
  Plus, Trash2, ArrowUp, ArrowDown, Upload, Loader2, ChevronDown, Music, ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "./api";

type MediaStatus = { available: boolean; maxBytes: number; reason?: string; code?: string | null };

/** فرمت‌هایی که هم تلگرام می‌پذیرد و هم سرور اجازه می‌دهد. */
const ACCEPT = "image/*,audio/*";

function useMediaStatus(botId: string) {
  return useQuery({
    queryKey: ["bot-media-status", botId],
    queryFn: () => customFetch<MediaStatus>(`/api/bots/${botId}/media-status`),
    staleTime: 60_000,
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * `file_id`های تلگرام معمولاً ۵۰+ کاراکترند و بدون فاصله — یعنی هیچ نقطه‌ی
 * شکستی برای بسته‌بندی خط ندارند. CSS-only `truncate` روی یک `<code>` که
 * ذاتاً `inline` است اصلاً اثر نمی‌کند (`text-overflow` فقط روی block
 * container کار می‌کند)، پس بدون این کوتاه‌سازیِ صریح، رشته کل باکس/دیالوگ را
 * از عرض خارج می‌کرد. کوتاه می‌کنیم، صرف‌نظر از عرض ظرف.
 */
function shortFileId(fileId: string): string {
  return fileId.length > 18 ? `${fileId.slice(0, 10)}…${fileId.slice(-4)}` : fileId;
}

/**
 * چیزی که درباره‌ی هر `file_id` می‌دانیم.
 *
 * روی شیت فقط `file_id` ذخیره می‌شود (شکلی که خودِ بات می‌خواند)، پس نوع و
 * مدت **حالت گذرا**ی همین صفحه‌اند: بعد از آپلود از پاسخ سرور می‌آیند، و
 * برای فایل‌های قدیمی از روی خودِ پیش‌نمایش حدس زده می‌شوند. هیچ‌کدام در
 * شیت نوشته نمی‌شوند — وگرنه شکل داده با آنچه بات انتظار دارد فرق می‌کرد.
 */
export type MediaMeta = { kind: "photo" | "audio" | "unknown"; duration: number | null };

/**
 * ردیف یک مدیا: پیش‌نمایش واقعی (تصویر یا پخش‌کننده‌ی صوت)، نه یک رشته‌ی
 * `file_id`. کاربر باید ببیند چه چیزی قرار است در پیام بات ظاهر شود.
 */
function MediaRow({
  botId, fileId, index, total, multiple, meta, onMeta, onMove, onRemove, t,
}: {
  botId: string;
  fileId: string;
  index: number;
  total: number;
  multiple: boolean;
  meta: MediaMeta | undefined;
  onMeta: (meta: MediaMeta) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  t: Record<string, string>;
}) {
  const src = `/api/bots/${botId}/media/${encodeURIComponent(fileId)}`;
  // نوع نامعلوم: اول تصویر امتحان می‌شود و اگر لود نشد، صوت. این تنها راهِ
  // بدون تغییرِ شکل داده روی شیت است.
  const kind = meta?.kind ?? "unknown";

  return (
    <li className="flex items-center gap-2 rounded-md border p-2">
      <span className="text-xs text-muted-foreground tabular-nums">{index + 1}</span>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {kind !== "audio" && (
          // پیش‌نمایش از پروکسی سرور می‌آید؛ URL خام تلگرام توکن بات را
          // داخل خودش دارد و هرگز به کلاینت نمی‌رسد.
          <img
            src={src}
            alt=""
            loading="lazy"
            className="size-12 shrink-0 rounded border object-cover"
            onLoad={() => { if (kind === "unknown") onMeta({ kind: "photo", duration: null }); }}
            onError={() => { if (kind === "unknown") onMeta({ kind: "audio", duration: null }); }}
          />
        )}

        {kind === "audio" ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Music className="size-4 shrink-0 text-muted-foreground" />
            <audio
              src={src}
              controls
              preload="metadata"
              className="h-8 min-w-0 flex-1"
              onLoadedMetadata={(e) => {
                const d = (e.currentTarget as HTMLAudioElement).duration;
                if (meta?.duration == null && Number.isFinite(d)) onMeta({ kind: "audio", duration: d });
              }}
            />
            {meta?.duration != null && (
              <span dir="ltr" className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {formatDuration(meta.duration)}
              </span>
            )}
          </div>
        ) : (
          <code
            dir="ltr"
            title={fileId}
            className="block min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
          >
            {shortFileId(fileId)}
          </code>
        )}
      </div>

      {multiple && (
        <>
          <Button variant="ghost" size="icon" aria-label={t.mediaMoveUp} disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t.mediaMoveDown} disabled={index === total - 1} onClick={() => onMove(1)}>
            <ArrowDown className="size-4" />
          </Button>
        </>
      )}
      <Button variant="ghost" size="icon" aria-label={t.mediaRemove} onClick={onRemove}>
        <Trash2 className="size-4 text-destructive" />
      </Button>
    </li>
  );
}

export function MediaList({
  botId,
  fileIds,
  multiple,
  onChange,
  onMetaChange,
  onWantMore,
}: {
  botId: string;
  fileIds: string[];
  /** نوع carousel چند فایل می‌گیرد؛ بقیه فقط یکی. */
  multiple: boolean;
  onChange: (next: string[]) => void;
  /** نوع واقعیِ هر فایل (از پاسخ آپلود) — برای اینکه پیش‌نمایش هم بداند، نه
      اینکه خودش دوباره از روی خطای <img> حدس بزند. */
  onMetaChange?: (meta: Record<string, MediaMeta>) => void;
  /** کاربر می‌خواهد مدیای دومی اضافه کند در حالی که نوع پنل هنوز تک‌مدیایی
      است — تصمیم اینکه نوع به carousel تغییر کند با صداکننده است. */
  onWantMore?: () => void;
}) {
  const t = useT("botPanels");
  const { toast } = useToast();
  const { data: status } = useMediaStatus(botId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [manual, setManual] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [meta, setMetaState] = useState<Record<string, MediaMeta>>({});
  const setMeta: typeof setMetaState = (update) => {
    setMetaState((prev) => {
      const next = typeof update === "function" ? (update as (p: typeof prev) => typeof prev)(prev) : update;
      onMetaChange?.(next);
      return next;
    });
  };

  const atLimit = !multiple && fileIds.length >= 1;

  // آپلود در دسترس نیست → بخش دستی باید از اول باز باشد، وگرنه کاربر هیچ راهی
  // برای افزودن مدیا نمی‌بیند.
  useEffect(() => {
    if (status && !status.available) setShowManual(true);
  }, [status]);

  function addFileId(fileId: string, withMeta?: MediaMeta) {
    const value = fileId.trim();
    if (!value) return;
    if (fileIds.includes(value)) {
      toast({ variant: "destructive", title: t.mediaDuplicate });
      return;
    }
    if (withMeta) setMeta((prev) => ({ ...prev, [value]: withMeta }));
    onChange(multiple ? [...fileIds, value] : [value]);
    setManual("");
  }

  async function upload(file: File) {
    // همان محدودیتی که سرور اعمال می‌کند، فقط زودتر و با پیام بهتر.
    if (!file.type.startsWith("image/") && !file.type.startsWith("audio/")) {
      toast({ variant: "destructive", title: t.mediaTypeUnsupported });
      return;
    }
    const max = status?.maxBytes ?? 7 * 1024 * 1024;
    if (file.size > max) {
      toast({
        variant: "destructive",
        title: t.mediaTooLarge.replace("{mb}", String(Math.round(max / 1024 / 1024))),
      });
      return;
    }
    setUploading(true);
    try {
      // ⚠️ عمداً بدون تبدیل به WebP (برخلاف بقیه‌ی آپلودهای سایت): این فایل
      // مقصدش تلگرام است و تلگرام WebP را استیکر می‌فهمد نه عکس.
      const dataUrl = await readAsDataUrl(file);
      const res = await customFetch<{ fileId: string; type: string; duration: number | null }>(
        `/api/bots/${botId}/media`,
        { method: "POST", body: JSON.stringify({ dataUrl, filename: file.name }) }
      );
      addFileId(res.fileId, {
        kind: res.type === "photo" ? "photo" : "audio",
        duration: res.duration,
      });
      toast({ title: t.mediaUploaded });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.errorGeneric, description: apiErrorMessage(err, t.errorGeneric) });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  /** چند فایل با هم فقط وقتی معنی دارد که پنل چندتایی باشد. */
  async function uploadAll(files: FileList | File[]) {
    const list = Array.from(files);
    for (const file of multiple ? list : list.slice(0, 1)) {
      await upload(file);
    }
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= fileIds.length) return;
    const next = [...fileIds];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {fileIds.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          {t.noMedia}
        </p>
      ) : (
        <ul className="space-y-2">
          {fileIds.map((fileId, index) => (
            <MediaRow
              key={`${fileId}-${index}`}
              botId={botId}
              fileId={fileId}
              index={index}
              total={fileIds.length}
              multiple={multiple}
              meta={meta[fileId]}
              onMeta={(m) => setMeta((prev) => ({ ...prev, [fileId]: m }))}
              onMove={(delta) => move(index, delta)}
              onRemove={() => onChange(fileIds.filter((_, i) => i !== index))}
              t={t as unknown as Record<string, string>}
            />
          ))}
        </ul>
      )}

      {/* نوع فعلی پنل تک‌مدیایی است، ولی چون carousel وجود دارد راه‌حل «نوعش
          را عوض کن» است نه بن‌بست — کاربر معمولی خودش نمی‌داند باید اول
          نوع پنل را عوض کند تا بشود مدیای دوم اضافه کرد. */}
      {atLimit && onWantMore && (
        <Button type="button" variant="outline" size="sm" onClick={onWantMore}>
          <Plus className="me-1.5 size-4" /> {t.mediaAddMore}
        </Button>
      )}

      {!atLimit && (
        <div className="space-y-3">
          {status?.available && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (e.dataTransfer.files.length > 0) uploadAll(e.dataTransfer.files);
              }}
              className={`flex flex-col items-center gap-2 rounded-md border-2 border-dashed p-6 text-center transition-colors ${
                dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25"
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                multiple={multiple}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) uploadAll(e.target.files);
                }}
              />
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <ImageIcon className="size-4" />
                <Music className="size-4" />
              </div>
              <p className="text-sm text-muted-foreground">{t.mediaDropHint}</p>
              <Button variant="outline" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
                {uploading ? <Loader2 className="me-1.5 size-4 animate-spin" /> : <Upload className="me-1.5 size-4" />}
                {t.mediaUpload}
              </Button>
              <p className="text-xs text-muted-foreground">
                {t.mediaAcceptHint.replace("{mb}", String(Math.round((status.maxBytes ?? 0) / 1024 / 1024)))}
              </p>
            </div>
          )}

          {status && !status.available && (
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              {status.reason ?? t.mediaUploadUnavailable}
            </p>
          )}

          {/* ورودی دستی: هنوز هست، ولی دیگر اولین چیزی نیست که کاربر می‌بیند. */}
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setShowManual((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={`size-3.5 transition-transform ${showManual ? "" : "-rotate-90 rtl-flip"}`} />
              {t.mediaManualToggle}
            </button>

            {showManual && (
              <div className="space-y-1.5 ps-1">
                <Label htmlFor="media-manual">{t.mediaManualLabel}</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="media-manual"
                    dir="ltr"
                    className="font-mono text-sm"
                    value={manual}
                    onChange={(e) => setManual(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addFileId(manual);
                      }
                    }}
                  />
                  <Button variant="outline" className="shrink-0" onClick={() => addFileId(manual)} disabled={!manual.trim()}>
                    <Plus className="me-1.5 size-4" /> {t.mediaAdd}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t.mediaManualHint}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
