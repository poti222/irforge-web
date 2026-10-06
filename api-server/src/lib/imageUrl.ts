/**
 * lib/imageUrl.ts — آدرسِ تصویرِ قابلِ‌ذخیره: URLِ http(s) (لینک‌هایِ دستیِ قدیمی همچنان کار می‌کنند) یا آدرسِ
 * داخلیِ آپلودِ سایت (`/api/uploads/images/<uuid>`). هر چیزِ دیگر (javascript:، data:، مسیرِ دلخواه) رد می‌شود.
 */
const UPLOAD_RE = /^\/api\/uploads\/images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** null = پاک‌کردن؛ undefined = نامعتبر. */
export function normalizeImageUrl(v: unknown): string | null | undefined {
  if (v === null || v === "") return null;
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return null;
  if (s.length > 2048) return undefined;
  if (UPLOAD_RE.test(s)) return s;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? s : undefined;
  } catch {
    return undefined;
  }
}
