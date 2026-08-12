/**
 * MediaList.tsx — مدیریت مدیای پنل به‌صورت **لیست** (باگ B2).
 *
 * در بات، ویرایش مدیا روی یک پنل carousel کل `media_ids` را با تک فایل جدید
 * جایگزین می‌کند (`fsm_edit_media`: `media_ids=[fid]`) و کل کاروسل نابود
 * می‌شود. اینجا هر مدیا جداگانه اضافه/حذف/جابه‌جا می‌شود و هیچ عملیاتی کل لیست
 * را replace نمی‌کند.
 *
 * دو مسیر ورود: آپلود واقعی (اگر سرور بگوید ممکن است) و `file_id` دستی — که
 * همیشه در دسترس است، چون آپلود به چت مقصد و توکن بات وابسته است و ممکن است
 * روی یک بات خاص کار نکند.
 */
import { useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, ArrowUp, ArrowDown, Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "./api";

type MediaStatus = { available: boolean; maxBytes: number; reason?: string; code?: string | null };

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

export function MediaList({
  botId,
  fileIds,
  multiple,
  onChange,
}: {
  botId: string;
  fileIds: string[];
  /** نوع carousel چند فایل می‌گیرد؛ بقیه فقط یکی. */
  multiple: boolean;
  onChange: (next: string[]) => void;
}) {
  const t = useT("botPanels");
  const { toast } = useToast();
  const { data: status } = useMediaStatus(botId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [manual, setManual] = useState("");
  const [uploading, setUploading] = useState(false);

  const atLimit = !multiple && fileIds.length >= 1;

  function addFileId(fileId: string) {
    const value = fileId.trim();
    if (!value) return;
    if (fileIds.includes(value)) {
      toast({ variant: "destructive", title: t.mediaDuplicate });
      return;
    }
    onChange(multiple ? [...fileIds, value] : [value]);
    setManual("");
  }

  async function upload(file: File) {
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
      const dataUrl = await readAsDataUrl(file);
      const res = await customFetch<{ fileId: string }>(`/api/bots/${botId}/media`, {
        method: "POST",
        body: JSON.stringify({ dataUrl, filename: file.name }),
      });
      addFileId(res.fileId);
      toast({ title: t.mediaUploaded });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.errorGeneric, description: apiErrorMessage(err, t.errorGeneric) });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
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
            <li key={`${fileId}-${index}`} className="flex items-center gap-2 rounded-md border p-2">
              <span className="text-xs text-muted-foreground tabular-nums">{index + 1}</span>
              {/* پیش‌نمایش از پروکسی سرور می‌آید؛ URL خام تلگرام توکن بات را
                  داخل خودش دارد و هرگز به کلاینت نمی‌رسد. */}
              <img
                src={`/api/bots/${botId}/media/${encodeURIComponent(fileId)}`}
                alt=""
                loading="lazy"
                className="size-10 shrink-0 rounded border object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
              <code dir="ltr" className="min-w-0 flex-1 truncate font-mono text-xs">{fileId}</code>
              {multiple && (
                <>
                  <Button variant="ghost" size="icon" aria-label={t.mediaMoveUp} disabled={index === 0} onClick={() => move(index, -1)}>
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" aria-label={t.mediaMoveDown}
                    disabled={index === fileIds.length - 1} onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                </>
              )}
              <Button
                variant="ghost" size="icon" aria-label={t.mediaRemove}
                onClick={() => onChange(fileIds.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {!atLimit && (
        <div className="space-y-2">
          {status?.available ? (
            <div>
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload(file);
                }}
              />
              <Button variant="outline" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
                {uploading ? <Loader2 className="me-1.5 size-4 animate-spin" /> : <Upload className="me-1.5 size-4" />}
                {t.mediaUpload}
              </Button>
            </div>
          ) : (
            status && <p className="text-xs text-muted-foreground">{status.reason ?? t.mediaUploadUnavailable}</p>
          )}

          <div className="space-y-1.5">
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
        </div>
      )}
    </div>
  );
}
