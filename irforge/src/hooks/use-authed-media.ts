/**
 * use-authed-media.ts
 * ─────────────────────────────────────────────────────────
 * `/api/bots/:id/media/:fileId` (و هر مسیرِ مشابهِ پروکسیِ مدیا) پشتِ
 * `requireAuth` است — هدرِ `Authorization: Bearer ...` لازم دارد. یک
 * `<img src="...">`/`<audio src="...">`/ناوبریِ `<a href="...">` خامِ
 * مرورگر هیچ‌وقت نمی‌تواند هدرِ سفارشی بفرستد (فقط fetch/XHR می‌توانند)،
 * پس این مسیرها همیشه با ۴۰۱ رد می‌شدند و پیش‌نمایش/دانلود خراب می‌ماند —
 * زنده دیده شد (noshazin_bot، ۴۰۱ پشتِ‌سرهم روی همین مسیر، از داخلِ
 * ویرایشگرِ پنل).
 *
 * `useAuthedBlobUrl` بایت‌ها را با `customFetch` (که توکن را خودش اضافه
 * می‌کند) می‌گیرد و یک `blob:` URL محلی می‌سازد که <img>/<audio> بدونِ هیچ
 * authِ اضافه‌ای لودش می‌کنند. `openAuthedMediaInNewTab` همان کار را برایِ
 * «باز کردن در تبِ جدید» / دانلود انجام می‌دهد، چون `<a href>` هم همین
 * مشکل را دارد.
 */
import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";

export function useAuthedBlobUrl(apiUrl: string | null | undefined): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });

  useEffect(() => {
    if (!apiUrl) {
      setState({ url: null, failed: false });
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ url: null, failed: false });
    (async () => {
      try {
        const blob = await customFetch<Blob>(apiUrl, { responseType: "blob" });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, failed: false });
      } catch {
        if (!cancelled) setState({ url: null, failed: true });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [apiUrl]);

  return state;
}

/** برایِ لینک‌هایِ «باز کردن در تبِ جدید»/دانلود — بایت‌ها را می‌گیرد و خودش
 * یک تبِ جدید با `blob:` URL باز می‌کند (نه ناوبریِ مستقیمِ مرورگر، که
 * هدرِ auth را نمی‌فرستد و ۴۰۱ می‌گیرد). */
export async function openAuthedMediaInNewTab(apiUrl: string): Promise<void> {
  const blob = await customFetch<Blob>(apiUrl, { responseType: "blob" });
  const objectUrl = URL.createObjectURL(blob);
  window.open(objectUrl, "_blank", "noopener,noreferrer");
  // تأخیرِ کوتاه قبل از revoke — تبِ تازه‌باز باید فرصتِ لودکردن داشته باشد.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
