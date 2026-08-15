/**
 * PanelPreview.tsx — شبیه‌سازی همان پیامی که بات می‌فرستد.
 *
 * چیدمان دکمه‌ها **از همان مدل ردیف‌های ویرایشگر** رندر می‌شود، نه از یک
 * ترتیب حدسی؛ پس چیزی که در پیش‌نمایش می‌بینی همان چیزی است که ذخیره می‌شود و
 * بات می‌کشد (`handlers/user.py` دکمه‌ها را بر اساس `row` گروه می‌کند).
 */
import { useState } from "react";
import { Bot, Image as ImageIcon, Film, Music, FileText, Images } from "lucide-react";
import { useT } from "@/hooks/use-translation";
import type { PanelButton } from "@/lib/panel-buttons";

const MEDIA_ICON: Record<string, typeof ImageIcon> = {
  photo: ImageIcon,
  carousel: Images,
  video: Film,
  audio: Music,
  document: FileText,
};

const STYLE_CLASS: Record<string, string> = {
  success: "border-emerald-500/50 text-emerald-600 dark:text-emerald-400",
  danger: "border-red-500/50 text-red-600 dark:text-red-400",
  primary: "border-primary/50 text-primary",
};

/**
 * یک مدیا در پیش‌نمایش. چون روی شیت فقط `file_id` هست و نوعش معلوم نیست،
 * اول تصویر امتحان می‌شود و اگر لود نشد به پخش‌کننده‌ی صوت سوییچ می‌کند —
 * همان روشی که MediaList استفاده می‌کند.
 */
function MediaThumb({ botId, fileId }: { botId: string; fileId: string }) {
  const [isAudio, setIsAudio] = useState(false);
  const src = `/api/bots/${botId}/media/${encodeURIComponent(fileId)}`;

  if (isAudio) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
        <Music className="size-4 shrink-0 text-muted-foreground" />
        <audio src={src} controls preload="metadata" className="h-8 min-w-0 flex-1" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className="max-h-44 w-full rounded-md border object-cover"
      onError={() => setIsAudio(true)}
    />
  );
}

export function PanelPreview({
  title,
  content,
  type,
  media,
  botId,
  rows,
  watermark,
  hasParent,
}: {
  title: string;
  content: string;
  type: string;
  /** file_idهای مدیا — برای رندر واقعی، نه فقط شمردن. */
  media: string[];
  botId: string;
  rows: PanelButton[][];
  watermark?: string;
  hasParent: boolean;
}) {
  const t = useT("botPanels");
  const MediaIcon = MEDIA_ICON[type];
  const mediaCount = media.length;

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{t.previewTitle}</p>
      <div className="flex gap-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Bot className="size-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-2 rounded-lg rounded-ss-none border bg-card p-3 shadow-sm">
          {/* مدیا واقعاً رندر می‌شود، نه به‌شکل «۲ فایل»: کاربر باید همان چیزی
              را ببیند که در پیام تلگرام ظاهر می‌شود. تصویر و صوت از پروکسیِ
              سرور می‌آیند (توکن بات هرگز به مرورگر نمی‌رسد). */}
          {MediaIcon && mediaCount === 0 && (
            <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/50 p-3 text-xs text-muted-foreground">
              <MediaIcon className="size-4 shrink-0" />
              <span>{t.previewMediaMissing}</span>
            </div>
          )}

          {mediaCount > 0 && (
            <div className={mediaCount > 1 ? "grid grid-cols-2 gap-1" : ""}>
              {media.map((fileId) => (
                <MediaThumb key={fileId} botId={botId} fileId={fileId} />
              ))}
            </div>
          )}

          {title && <p className="font-semibold">{title}</p>}
          {/* متن پنل ممکن است چندخطی باشد؛ بات هم همان‌طور می‌فرستد. */}
          <p className="whitespace-pre-wrap break-words text-sm">
            {content || <span className="text-muted-foreground">{t.previewNoContent}</span>}
          </p>
          {watermark && <p className="text-xs italic text-muted-foreground">{watermark}</p>}

          {(rows.some((r) => r.length > 0) || hasParent) && (
            <div className="space-y-1 pt-1">
              {rows
                .filter((row) => row.length > 0)
                .map((row, i) => (
                  <div key={i} className="flex gap-1">
                    {row.map((button, j) => (
                      <span
                        key={j}
                        className={`min-w-0 flex-1 truncate rounded-md border bg-background px-2 py-1.5 text-center text-xs ${
                          STYLE_CLASS[button.style] ?? ""
                        }`}
                      >
                        {button.label || t.previewUnnamedButton}
                      </span>
                    ))}
                  </div>
                ))}
              {/* بات برای هر پنلِ دارای والد خودش یک دکمه‌ی «بازگشت» اضافه می‌کند
                  (`handlers/user.py`) — پیش‌نمایش بدون آن گمراه‌کننده است. */}
              {hasParent && (
                <div className="flex gap-1">
                  <span className="min-w-0 flex-1 truncate rounded-md border border-dashed bg-background px-2 py-1.5 text-center text-xs text-muted-foreground">
                    {t.previewBackButton}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
