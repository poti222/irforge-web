import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReceiptLightbox } from "@/components/ui/receipt-lightbox";
import { useT } from "@/hooks/use-translation";
import { useUnseenUpdate } from "@/hooks/use-unseen-update";

/**
 * مودالِ «آپدیت جدید سایت» روی داشبورد.
 *
 * فقط جدیدترین آپدیتِ دیده‌نشده را نشان می‌دهد، و بستنش **همه‌ی** آپدیت‌های
 * منتشرشده را برای این کاربر seen می‌کند — وگرنه اگر ادمین سه آپدیت پشت‌سرهم
 * منتشر کند، کاربر سه مودال پشت‌سرهم می‌گیرد.
 *
 * وقتی چیزی برای نشان‌دادن نیست هیچ چیزی رندر نمی‌کند، پس امن است که همیشه
 * در داشبورد سوار باشد.
 */
export function UpdateDialog() {
  const t = useT("updates");
  const queryClient = useQueryClient();
  const { data } = useUnseenUpdate();
  // بعد از بستن، تا وقتی کوئری تازه نشده نباید دوباره باز شود.
  const [dismissed, setDismissed] = useState(false);

  const update = data?.update ?? null;
  const open = Boolean(update) && !dismissed;

  async function dismiss() {
    // مودال بلافاصله بسته می‌شود؛ ثبت seen پشت سرش انجام می‌شود. مودالی که
    // به‌خاطر یک خطای شبکه باز بماند از خودِ فیچر بدتر است.
    setDismissed(true);
    try {
      // بدون updateId یعنی «همه‌ی منتشرشده‌ها».
      await customFetch("/api/updates/seen", { method: "POST", body: JSON.stringify({}) });
    } catch (err) {
      console.warn("Failed to mark updates seen", err);
    } finally {
      queryClient.invalidateQueries({ queryKey: ["update-unseen"] });
      queryClient.invalidateQueries({ queryKey: ["updates"] });
    }
  }

  if (!update) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) void dismiss(); }}>
      {/* روی موبایل متن بلند + گالری باید داخل خود مودال اسکرول شود. */}
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          {update.version && (
            <Badge variant="secondary" className="w-fit">
              {t.version} {update.version}
            </Badge>
          )}
          <DialogTitle className="text-start">{update.title}</DialogTitle>
          {update.publishedAt && (
            <DialogDescription className="text-start">
              {t.publishedOn} {new Date(update.publishedAt).toLocaleDateString()}
            </DialogDescription>
          )}
        </DialogHeader>

        <p className="whitespace-pre-wrap text-sm leading-7">{update.body}</p>

        {update.images.length > 0 && (
          <div className="space-y-2">
            {update.images.map((src, i) => (
              <ReceiptLightbox key={i} src={src} alt={`${t.imageAlt} ${i + 1}`}>
                <button type="button" className="block w-full">
                  <img
                    src={src}
                    alt={`${t.imageAlt} ${i + 1}`}
                    loading="lazy"
                    decoding="async"
                    className="w-full rounded-lg border"
                  />
                </button>
              </ReceiptLightbox>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button onClick={() => void dismiss()}>{t.gotIt}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
