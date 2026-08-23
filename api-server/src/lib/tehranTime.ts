/**
 * lib/tehranTime.ts — «امروز» یعنی امروز به وقت تهران.
 * ─────────────────────────────────────────────────────────────────────────────
 * سرور روی Railway با ساعت UTC بالا می‌آید، ولی کاربران این سایت در ایران
 * زندگی می‌کنند. «کاربران فعال امروز» اگر با روزِ UTC حساب شود، هر شب از
 * ساعت ۳:۳۰ بامداد به وقت تهران عوض می‌شود — یعنی فعالیت نیمه‌شب کاربر در
 * سطل «دیروز» می‌افتد.
 *
 * روش درست، و تنها روشی که اینجا استفاده می‌شود، `Intl.DateTimeFormat` با
 * `timeZone: "Asia/Tehran"` است. حساب دستی با آفستِ ثابت (+3:30) اشتباه است
 * چون آفست تهران در گذشته تغییر کرده و ایران تا ۱۴۰۱ ساعت تابستانی داشت؛
 * `Intl` این‌ها را از پایگاه‌داده‌ی IANA می‌خواند و همیشه درست می‌دهد.
 */

const DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tehran",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * زمان‌های نوشته‌شده توسط بات را درست تفسیر می‌کند.
 *
 * بات با `datetime.utcnow().isoformat()` می‌نویسد — یعنی رشته‌ای **بدون**
 * پسوند منطقه‌ی زمانی، مثل `2026-08-15T21:00:00.123456`. `new Date()` چنین
 * رشته‌ای را **ساعت محلیِ همان ماشین** می‌فهمد، نه UTC. روی Railway که ساعتش
 * UTC است این تصادفاً درست درمی‌آید، ولی روی هر محیط دیگری (و در تست) چند
 * ساعت جابه‌جا می‌شود — دقیقاً همان دسته باگی که این ماژول برای حذفش نوشته شده.
 *
 * پس اگر رشته پسوند منطقه ندارد، صریحاً `Z` اضافه می‌شود.
 */
function parseBotTimestamp(value: string): Date {
  const trimmed = value.trim();
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  // فقط به چیزی که واقعاً شکل تاریخ-و-ساعت دارد پسوند اضافه می‌شود؛ یک
  // `YYYY-MM-DD` تنها از قبل به‌عنوان UTC خوانده می‌شود.
  const needsZone = !hasZone && trimmed.includes("T");
  return new Date(needsZone ? `${trimmed}Z` : trimmed);
}

/**
 * تاریخِ تقویمی تهران به شکل `YYYY-MM-DD`.
 *
 * لوکال `en-CA` عمداً انتخاب شده: تنها لوکال رایجی که خروجی پیش‌فرضش دقیقاً
 * ISO است، پس نیازی به سرهم‌کردن دستیِ `formatToParts` نیست.
 */
export function tehranDayKey(date: Date | number | string): string {
  const d =
    date instanceof Date ? date : typeof date === "string" ? parseBotTimestamp(date) : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return DAY_FORMATTER.format(d);
}

/** کلیدِ روزِ امروز به وقت تهران. */
export function tehranToday(): string {
  return tehranDayKey(new Date());
}

/**
 * `n` کلیدِ روزِ اخیر به وقت تهران، از قدیم به جدید (آخرین عضو = امروز).
 *
 * لنگر باید روزِ تقویمیِ **تهران** باشد، نه UTC: تهران ۳:۳۰ ساعت جلوتر است،
 * پس هر شب از ۲۰:۳۰ تا ۲۴:۰۰ UTC (یعنی ۰۰:۰۰ تا ۰۳:۳۰ بامدادِ روزِ بعد به
 * وقت تهران) روزِ تقویمیِ UTC هنوز دیروز است در حالی که در تهران امروز
 * شروع شده. لنگرگرفتن روی «تاریخِ UTC همین لحظه» دقیقاً همان کلاسِ باگی است
 * که خودِ این ماژول برای رفعش نوشته شده — با این تفاوت که اینجا به‌جای یک
 * timestamp، خودِ محورِ روزها یک روز عقب می‌افتاد.
 *
 * پس اول `tehranToday()` گرفته می‌شود (تاریخِ تقویمیِ درستِ تهران)، و لنگر
 * روی ظهرِ UTC **همان روزِ تقویمی** ساخته می‌شود — نه ظهرِ UTC روزِ جاریِ
 * سرور. عقب‌رفتن هم از ظهر انجام می‌شود نه از نیمه‌شب: در روزِ تغییر ساعت
 * (هرچند ایران دیگر ساعت تابستانی ندارد) ظهر از هر دو مرز فاصله‌ی کافی دارد.
 */
export function tehranLastDays(n: number): string[] {
  const out: string[] = [];
  const anchorNoonUtc = new Date(`${tehranToday()}T12:00:00Z`);
  for (let i = n - 1; i >= 0; i--) {
    out.push(tehranDayKey(new Date(anchorNoonUtc.getTime() - i * 24 * 60 * 60 * 1000)));
  }
  return out;
}
