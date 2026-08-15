/**
 * lib/image.ts — تبدیل تصاویر آپلودی به WebP، سمت مرورگر.
 * ─────────────────────────────────────────────────────────────────────────────
 * هر تصویری که کاربر آپلود می‌کند (فیش واریز، تصاویر آپدیت‌های سایت، آواتار)
 * به شکل data-URL در دیتابیس ذخیره و بعداً همان‌طور سرو می‌شود. یک JPEG
 * ۳ مگابایتیِ عکس‌گرفته‌شده با موبایل، بعد از base64 حدود ۴ مگابایت در دیتابیس
 * می‌گیرد و همان حجم را با هر بار نمایش روی شبکه می‌فرستد. WebP معمولاً
 * ۲۵ تا ۳۵ درصد کوچک‌تر از JPEG هم‌کیفیت است، و در کنار تغییر اندازه به یک
 * بُعد معقول، حجم را یک مرتبه‌ی بزرگی کم می‌کند.
 *
 * **چرا سمت مرورگر و نه سمت سرور؟** تبدیل سمت سرور یک کتابخانه‌ی نیتیو
 * (`sharp`) می‌خواهد که روی Railway باید کامپایل/دانلود شود و به وابستگی‌های
 * سیستمی گره می‌خورد؛ در حالی که `canvas.toBlob("image/webp")` در همه‌ی
 * مرورگرهای مدرن هست، هیچ وابستگی‌ای اضافه نمی‌کند، و بایتِ اضافه اصلاً از
 * دستگاه کاربر بیرون نمی‌آید — یعنی آپلود هم سریع‌تر می‌شود.
 *
 * ⚠️ **این را برای تصاویری که مقصدشان تلگرام است استفاده نکنید.** تلگرام
 * WebP را به‌عنوان *استیکر* می‌شناسد، نه عکس؛ `sendPhoto`/`setMyProfilePhoto`
 * با WebP یا رد می‌شوند یا نتیجه‌ی عجیب می‌دهند. مسیرهای مدیای بات
 * (`MediaList`, `BotProfileForm`) عمداً فایل را دست‌نخورده می‌فرستند.
 */

/** حداکثر بُعد بلندتر تصویر بعد از تبدیل. */
const DEFAULT_MAX_DIMENSION = 1600;
/** کیفیت WebP — ۰.۸۲ مرزی است که تفاوتش با اصل عملاً دیده نمی‌شود. */
const DEFAULT_QUALITY = 0.82;

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = dataUrl;
  });
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * فایل تصویری را به data-URL با فرمت WebP تبدیل می‌کند.
 *
 * **هرگز throw نمی‌کند و هرگز خروجی بدتر از ورودی نمی‌دهد.** اگر مرورگر WebP
 * را انکود نکند، اگر تصویر decode نشود، یا اگر نتیجه از اصل بزرگ‌تر دربیاید
 * (روی تصاویر کوچکِ از قبل فشرده ممکن است)، همان data-URL اصلی برمی‌گردد.
 * فشرده‌سازی یک بهینه‌سازی است، نه یک پیش‌شرط.
 *
 * GIF عمداً دست‌نخورده می‌ماند: `canvas` فقط فریم اول را می‌گیرد و تبدیلش
 * انیمیشن را نابود می‌کند.
 */
export async function toWebpDataUrl(
  file: File,
  { maxDimension = DEFAULT_MAX_DIMENSION, quality = DEFAULT_QUALITY } = {},
): Promise<string> {
  const original = await readAsDataUrl(file);
  if (!file.type.startsWith("image/") || file.type === "image/gif") return original;

  try {
    const img = await loadImage(original);
    const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.drawImage(img, 0, 0, width, height);

    const webp = canvas.toDataURL("image/webp", quality);
    // مرورگری که WebP نمی‌شناسد بی‌سروصدا PNG می‌دهد — که تقریباً همیشه از
    // اصل بزرگ‌تر است. پس هم فرمت و هم حجم چک می‌شوند.
    if (!webp.startsWith("data:image/webp")) return original;
    return webp.length < original.length ? webp : original;
  } catch {
    return original;
  }
}

/** تخمین حجم واقعی یک data-URL به بایت (هر ۴ کاراکتر base64 = ۳ بایت). */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  return Math.floor(((dataUrl.length - comma - 1) * 3) / 4);
}
