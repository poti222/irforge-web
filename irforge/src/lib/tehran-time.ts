/**
 * tehran-time.ts — «الان» به وقت تهران، مستقل از ساعتِ مرورگر کاربر.
 * ─────────────────────────────────────────────────────────────────────────────
 * آینه‌ی `api-server/src/lib/tehranTime.ts`. هر جای فرانت که ساعت ایران را
 * لازم دارد باید از اینجا بگیرد، نه با حساب دستی.
 *
 * **باگی که این ماژول برای حذفش نوشته شد**، عیناً همان چیزی که در
 * `TabWorkingHours` بود:
 *
 *     const tehranMs = now.getTime() + (3*60+30)*60_000 + now.getTimezoneOffset()*60_000;
 *
 * `Date.getTime()` از قبل یک epoch از نوع UTC است و **هیچ‌وقت** به منطقه‌ی
 * زمانی مرورگر وابسته نیست. اضافه‌کردن `getTimezoneOffset()` روی آفست تهران،
 * یک‌بار اضافه حساب‌کردن است: نتیجه فقط وقتی درست درمی‌آید که خودِ مرورگر
 * روی تهران باشد (آفست‌ها همدیگر را خنثی می‌کنند). برای کاربری در اروپا،
 * ساعت دقیقاً به اندازه‌ی اختلاف آن منطقه با تهران غلط نشان داده می‌شد — و
 * چون فقط یک برچسبِ ساعت است، هیچ خطایی هم رخ نمی‌داد.
 *
 * راه درست `Intl.DateTimeFormat` با `timeZone: "Asia/Tehran"` است — که آفست
 * را از پایگاه‌داده‌ی IANA می‌خواند، نه از یک عدد ثابت. این هم مهم است: آفست
 * ایران تغییر کرده و تا ۱۴۰۱ ساعت تابستانی داشت، پس `+3:30` ثابت حتی برای
 * یک کاربر ایرانی هم برای تاریخ‌های گذشته غلط است.
 */

const TEHRAN = "Asia/Tehran";

const PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: TEHRAN,
  hour12: false,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** `Date.getDay()` (۰=یکشنبه) → قرارداد بات (۰=دوشنبه). */
export function jsDayToBotDay(jsDay: number): number {
  return (jsDay + 6) % 7;
}

const WEEKDAY_TO_JS: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** ساعت فعلی ایران — روزِ هفته به قرارداد بات، دقیقه از نیمه‌شب، و برچسب `HH:MM`. */
export function tehranNow(now: Date = new Date()): { day: number; minutes: number; label: string } {
  const parts = PARTS_FORMATTER.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  // `hour12: false` در بعضی محیط‌ها نیمه‌شب را «24» می‌دهد، نه «00».
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const jsDay = WEEKDAY_TO_JS[get("weekday")] ?? now.getUTCDay();

  return {
    day: jsDayToBotDay(jsDay),
    minutes: hour * 60 + minute,
    label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}
