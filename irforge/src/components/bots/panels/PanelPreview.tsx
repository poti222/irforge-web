/**
 * PanelPreview.tsx — شبیه‌سازی همان پیامی که بات می‌فرستد.
 *
 * چیدمان دکمه‌ها **از همان مدل ردیف‌های ویرایشگر** رندر می‌شود، نه از یک
 * ترتیب حدسی؛ پس چیزی که در پیش‌نمایش می‌بینی همان چیزی است که ذخیره می‌شود و
 * بات می‌کشد (`handlers/user.py` دکمه‌ها را بر اساس `row` گروه می‌کند).
 */
import { useState } from "react";
import { Bot, Film, Music, FileText, Images, Loader2 } from "lucide-react";
import { useT } from "@/hooks/use-translation";
import { useAuthedBlobUrl } from "@/hooks/use-authed-media";
import type { PanelButton } from "@/lib/panel-buttons";
import type { MediaMeta } from "./MediaList";

/** آیکونِ حالتِ «بدونِ مدیایِ انتخاب‌شده هنوز» — فقط برایِ نوعِ `media`. */
const MEDIA_ICON = Images;

const STYLE_CLASS: Record<string, string> = {
  success: "border-emerald-500/50 text-emerald-600 dark:text-emerald-400",
  danger: "border-red-500/50 text-red-600 dark:text-red-400",
  primary: "border-primary/50 text-primary",
};

/**
 * یک مدیا در پیش‌نمایش. اگر نوعش را از پاسخ آپلود (همان لحظه) می‌دانیم،
 * مستقیم همان را رندر می‌کنیم — دیگر لازم نیست حدس بزنیم. فقط برای پنلِ
 * از قبل ذخیره‌شده که تازه باز شده (روی شیت فقط `file_id` هست، نوعش معلوم
 * نیست) به روش قدیمی برمی‌گردیم: اول تصویر امتحان می‌شود و اگر لود نشد به
 * پخش‌کننده‌ی صوت سوییچ می‌کند.
 *
 * این حدسِ fallback همان چیزی بود که قبلاً **همیشه** اجرا می‌شد، حتی درست
 * بعد از یک آپلود موفق — و چون این پیش‌نمایش داخل ستون sticky است که هنگام
 * اولین رندر گاهی هنوز اندازه‌ی نهایی نگرفته، همان حدس گاهی به‌غلط روی صوت
 * می‌افتاد و یک عکسِ تازه‌آپلودشده را دائم به‌شکل پخش‌کننده‌ی صوتی نشان
 * می‌داد. دانستنِ نوعِ واقعی این مشکل را کلاً کنار می‌زند.
 */
function MediaThumb({ botId, fileId, knownKind }: { botId: string; fileId: string; knownKind?: MediaMeta["kind"] }) {
  const [guessedAudio, setGuessedAudio] = useState(false);
  const apiSrc = `/api/bots/${botId}/media/${encodeURIComponent(fileId)}`;
  const { url: blobSrc, failed } = useAuthedBlobUrl(apiSrc);
  const isAudio = knownKind ? knownKind === "audio" : guessedAudio || failed;

  if (isAudio) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
        <Music className="size-4 shrink-0 text-muted-foreground" />
        {blobSrc ? (
          <audio src={blobSrc} controls preload="metadata" className="h-8 min-w-0 flex-1" />
        ) : (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        )}
      </div>
    );
  }

  // ویدیو/فایل: بدونِ <img> (لود نمی‌شود)، فقط یک نشانِ عمومی.
  if (knownKind === "video" || knownKind === "document") {
    const Icon = knownKind === "video" ? Film : FileText;
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
        <Icon className="size-4 shrink-0" />
        <span dir="ltr" className="min-w-0 flex-1 truncate font-mono text-xs">{fileId}</span>
      </div>
    );
  }

  if (!blobSrc) {
    return (
      <div className="flex max-h-44 w-full items-center justify-center rounded-md border bg-muted/40 p-6">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <img
      src={blobSrc}
      alt=""
      className="max-h-44 w-full rounded-md border object-cover"
      onError={() => { if (!knownKind) setGuessedAudio(true); }}
    />
  );
}

export function PanelPreview({
  title,
  content,
  type,
  media,
  mediaMeta,
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
  /** نوع واقعیِ هر فایل، وقتی از پاسخ آپلود در همین صفحه شناخته شده. */
  mediaMeta?: Record<string, MediaMeta>;
  botId: string;
  rows: PanelButton[][];
  watermark?: string;
  hasParent: boolean;
}) {
  const t = useT("botPanels");
  const MediaIcon = type === "media" ? MEDIA_ICON : null;
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
                <MediaThumb
                  key={fileId}
                  botId={botId}
                  fileId={fileId}
                  knownKind={mediaMeta?.[fileId]?.kind === "unknown" ? undefined : mediaMeta?.[fileId]?.kind}
                />
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
