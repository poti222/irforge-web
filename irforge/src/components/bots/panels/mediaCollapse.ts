/**
 * mediaCollapse.ts
 * IRFORGE_TELEGRAM_UPLOAD_PANELTYPES_VPNDELIVERY_PROMPT — بخش B.
 * ─────────────────────────────────────────────────────────────────────────────
 * توابعِ خالصِ تبدیلِ شکلِ قدیمیِ داده‌ی پنل (۶ نوعِ مدیاییِ جدا + دو نوعِ
 * کیف‌پولِ جدا) به شکلِ ۵-نوعیِ تازه — دقیقاً همان قاعده‌ای که
 * `handlers/panel_builder.py::_normalize_ptype_for_save`/`_media_ids_of`ی
 * بات دارند. سایت هرگز پنل را رندر نمی‌کند (فقط بات)، پس اینجا فقط برای
 * **ویرایشِ راحتِ پنل‌هایِ هنوز-مهاجرت‌نشده** لازم است: تا اسکریپتِ مهاجرت
 * روی دیتایِ واقعی اجرا شود، این توابع اجازه می‌دهند ویرایشگرِ سایت هر پنلی
 * (قدیمی یا جدید) را یکسان نشان دهد، و ذخیره‌اش همیشه به شکلِ تازه باشد —
 * یعنی هر پنلی که از سایت ویرایش و ذخیره شود، همان‌جا هم مهاجرت می‌کند.
 */
import type { Panel } from "./api";

export type MediaItemType = "photo" | "video" | "audio" | "document";
export type PanelMediaItem = { type: MediaItemType; file_id: string };

const LEGACY_MEDIA_TYPES = new Set(["text", "photo", "video", "audio", "document", "carousel"]);
const MEDIA_SUBTYPES = new Set<string>(["photo", "video", "audio", "document"]);

/** آیا این رشته‌یِ type (قدیمی یا جدید) باید در ویرایشگر مثلِ «مدیا» رفتار کند؟ */
export function isMediaLikeType(type: string): boolean {
  return type === "media" || LEGACY_MEDIA_TYPES.has(type);
}

/** آیا این رشته‌یِ type (قدیمی یا جدید) باید در ویرایشگر مثلِ «کیف پول» رفتار کند؟ */
export function isWalletLikeType(type: string): boolean {
  return type === "wallet" || type === "wallet_balance";
}

/**
 * هر شکلِ ذخیره‌شده‌ی مدیا را (تازه: `settings.media_items`؛ قدیمی:
 * `media_file_id` + `settings.carousel_ids`) به یک آرایه‌ی یکنواخت تبدیل
 * می‌کند. اولویت با `media_items` است — اگر حاضر باشد یعنی این پنل از قبل
 * مهاجرت کرده (یا تازه از همین ویرایشگر ساخته شده).
 */
export function panelMediaItems(panel: Pick<Panel, "type" | "media_file_id" | "settings">): PanelMediaItem[] {
  const settings = (panel.settings ?? {}) as Record<string, unknown>;
  const stored = settings.media_items;
  if (Array.isArray(stored)) {
    return stored
      .map((it) => {
        const raw = it as { type?: unknown; file_id?: unknown } | null;
        const t = typeof raw?.type === "string" && MEDIA_SUBTYPES.has(raw.type) ? (raw.type as MediaItemType) : "photo";
        return { type: t, file_id: String(raw?.file_id ?? "").trim() };
      })
      .filter((it) => it.file_id);
  }

  if (panel.type === "carousel") {
    const ids = Array.isArray(settings.carousel_ids) ? (settings.carousel_ids as unknown[]) : [];
    return ids.map((id) => String(id ?? "").trim()).filter(Boolean).map((file_id) => ({ type: "photo" as const, file_id }));
  }

  if (panel.type !== "text" && LEGACY_MEDIA_TYPES.has(panel.type) && panel.media_file_id) {
    const subtype = MEDIA_SUBTYPES.has(panel.type) ? (panel.type as MediaItemType) : "photo";
    return [{ type: subtype, file_id: panel.media_file_id }];
  }

  return [];
}

/** حالتِ کیف‌پولِ یک پنل — قدیمی (`wallet_balance` = شخصی) یا تازه
 * (`wallet` + `settings.mode`، پیش‌فرضش «مشترک» تا رفتارِ پنل‌هایِ
 * ادغام‌نشده عوض نشود — همان پیش‌فرضِ خودِ بات). */
export function panelWalletMode(panel: Pick<Panel, "type" | "settings">): "shared" | "personal" {
  if (panel.type === "wallet_balance") return "personal";
  return panel.settings?.mode === "personal" ? "personal" : "shared";
}

/**
 * نوعِ واقعیِ یک فایل، از رویِ Content-Type واقعیِ سرور — همان مقداری که
 * پروکسیِ دانلود (`GET /api/bots/:id/media/:fileId`) از پاسخِ خودِ تلگرام
 * می‌گیرد و بدونِ تغییر forward می‌کند (`botMedia.ts`)، یعنی منبعِ حقیقتِ
 * واقعی است، نه یک حدس.
 *
 * جایگزینِ heuristicِ قدیمیِ «اگر بارگذاریِ blob شکست خورد یا `<img>` آن را
 * decode نکرد، حتماً صوت است» (`MediaList.tsx`ی سابق) — آن heuristic با هر
 * خطای موقتیِ شبکه هم فعال می‌شد، نه فقط وقتی فایل واقعاً صوت بود. زنده دیده
 * شد: noshazin_bot — یک عکس یک‌بار با ۴۰۱ پشتِ‌سرِ‌هم مواجه شد (باگِ دیگری،
 * الان رفع‌شده)، heuristic حدسِ «صوت» زد، و آن نوعِ غلط روی خودِ پنل ذخیره و
 * با هر ویرایشِ بعدیِ پنل (even بی‌ربط) دوباره ذخیره شد — چون
 * `PanelEditor.tsx`ی سایت نوعِ ذخیره‌شده را عینِ حقیقت فرض می‌کرد. حالا
 * `MediaRow` همیشه این تابع را روی mime‌typeِ واقعیِ خودِ فایل صدا می‌زند و
 * نتیجه را جایگزینِ هر نوعِ ذخیره‌شده‌ی قبلی می‌کند — چه پنل تازه باشد چه
 * قدیمی و از قبل با نوعِ غلط ذخیره‌شده — بدونِ هیچ حدسی. وقتی fetch خودِ blob
 * شکست بخورد mimeType هرگز نمی‌رسد، پس این تابع اصلاً صدا زده نمی‌شود و نوعِ
 * ذخیره‌شده دست‌نخورده می‌ماند — دیگر هیچ شکستِ موقتی نوعِ فایل را عوض
 * نمی‌کند.
 */
export function mediaKindFromMimeType(mimeType: string): MediaItemType {
  if (mimeType.startsWith("image/")) return "photo";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}
