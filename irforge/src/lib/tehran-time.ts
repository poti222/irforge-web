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

// ─── تقویم جلالی (فاز ۱۹) ────────────────────────────────────────────────────
//
// پورتِ مستقیمِ همان الگوریتمِ شمارشِ روزِ عمومی (public-domain) که
// `plugins/_common/jalali.py`ی بات استفاده می‌کند — نه یک کتابخانه‌ی جدید، نه
// یک الگوریتمِ متفاوت. جدول‌های ماه، قاعده‌ی کبیسه، و همان چرخه‌ی ۳۳ساله عیناً
// از آن‌جا کپی شده تا دو طرف همیشه یک جواب بدهند.
//
// **چرا اینجا و نه یک پکیجِ مشترک:** این تنها فایلِ سایت است که به تاریخ
// جلالی نیاز دارد (فرم زمان‌بندیِ کمپینِ drip)، و یک پکیجِ تازه فقط برای یک
// الگوریتمِ خالص و بدون وابستگی، هزینه‌ی ساختاریِ بی‌دلیل بود.

const G_DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const J_DAYS_IN_MONTH = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];

function isGregorianLeap(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** (میلادی) → (شمسی)، هر سه `[سال, ماه, روز]`. */
export function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const gy2 = gy - 1600;
  const gm2 = gm - 1;

  let gDayNo = 365 * gy2 + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400);
  for (let i = 0; i < gm2; i++) gDayNo += G_DAYS_IN_MONTH[i];
  if (gm2 > 1 && isGregorianLeap(gy)) gDayNo += 1;
  gDayNo += gd - 1;

  let jDayNo = gDayNo - 79;

  const jNp = Math.floor(jDayNo / 12053); // 12053 = یک چرخه‌ی ۳۳ساله‌ی جلالی
  jDayNo = jDayNo % 12053;

  let jy = 979 + 33 * jNp + 4 * Math.floor(jDayNo / 1461);
  jDayNo = jDayNo % 1461;

  if (jDayNo >= 366) {
    jy += Math.floor((jDayNo - 1) / 365);
    jDayNo = (jDayNo - 1) % 365;
  }

  for (let i = 0; i < 11; i++) {
    if (jDayNo < J_DAYS_IN_MONTH[i]) return [jy, i + 1, jDayNo + 1];
    jDayNo -= J_DAYS_IN_MONTH[i];
  }
  return [jy, 12, jDayNo + 1];
}

/** (شمسی) → (میلادی)، هر سه `[سال, ماه, روز]`. */
export function jalaliToGregorian(jy: number, jm: number, jd: number): [number, number, number] {
  const jy2 = jy - 979;
  const jm2 = jm - 1;

  let jDayNo = 365 * jy2 + Math.floor(jy2 / 33) * 8 + Math.floor(((jy2 % 33) + 3) / 4);
  for (let i = 0; i < jm2; i++) jDayNo += J_DAYS_IN_MONTH[i];
  jDayNo += jd - 1;

  let gDayNo = jDayNo + 79;

  let gy = 1600 + 400 * Math.floor(gDayNo / 146097);
  gDayNo = gDayNo % 146097;

  if (gDayNo >= 36525) {
    gDayNo -= 1;
    gy += 100 * Math.floor(gDayNo / 36524);
    gDayNo = gDayNo % 36524;
    if (gDayNo >= 365) gDayNo += 1;
  }

  gy += 4 * Math.floor(gDayNo / 1461);
  gDayNo = gDayNo % 1461;

  if (gDayNo >= 366) {
    gDayNo -= 1;
    gy += Math.floor(gDayNo / 365);
    gDayNo = gDayNo % 365;
  }

  const daysInMonth = [...G_DAYS_IN_MONTH];
  daysInMonth[1] = isGregorianLeap(gy) ? 29 : 28;
  for (let i = 0; i < 12; i++) {
    if (gDayNo < daysInMonth[i]) return [gy, i + 1, gDayNo + 1];
    gDayNo -= daysInMonth[i];
  }
  return [gy, 12, gDayNo + 1];
}

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** اعداد ASCII داخل یک رشته را به رقم فارسی تبدیل می‌کند — برای نمایش، نه ذخیره. */
export function toPersianDigits(value: string): string {
  return value.replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

/** رقم فارسی/عربی داخل یک رشته را به ASCII برمی‌گرداند — کیبورد گوشی معمولاً رقم فارسی می‌فرستد. */
export function fromPersianDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (d) => {
    const persian = PERSIAN_DIGITS.indexOf(d);
    if (persian >= 0) return String(persian);
    const arabic = "٠١٢٣٤٥٦٧٨٩".indexOf(d);
    return arabic >= 0 ? String(arabic) : d;
  });
}

/** میلادی → رشته‌ی نمایشیِ «۱۴۰۵/۰۶/۰۱». */
export function formatJalali(gy: number, gm: number, gd: number, persianDigits = true): string {
  const [jy, jm, jd] = gregorianToJalali(gy, gm, gd);
  const text = `${String(jy).padStart(4, "0")}/${String(jm).padStart(2, "0")}/${String(jd).padStart(2, "0")}`;
  return persianDigits ? toPersianDigits(text) : text;
}

export const JALALI_MONTH_NAMES_FA = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
] as const;

const WEEKDAY_NAMES_FA = ["دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه", "یکشنبه"] as const;

/** نام روز هفته به فارسی، با قراردادِ روزِ بات (۰=دوشنبه … ۶=یکشنبه). */
export function weekdayNameFa(botDay: number): string {
  return WEEKDAY_NAMES_FA[((botDay % 7) + 7) % 7];
}

/**
 * آفستِ تهران (به دقیقه) در لحظه‌ی `utcMs` — با `Intl.DateTimeFormat`، نه یک
 * عددِ ثابت، چون آفست ایران در گذشته تغییر کرده (ساعت تابستانی تا ۱۴۰۱).
 * ترفندِ استاندارد: زمان را در Asia/Tehran فرمت کن، همان اعداد را به‌عنوانِ
 * UTC دوباره بساز، و اختلافش با لحظه‌ی اصلی همان آفست است.
 */
const TEHRAN_OFFSET_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: TEHRAN,
  hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

function tehranOffsetMinutesAt(utcMs: number): number {
  const parts = TEHRAN_OFFSET_FORMATTER.formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - utcMs) / 60_000);
}

/**
 * (تاریخ شمسی + ساعت به وقت تهران) → رشته‌ی ISO با UTC.
 *
 * برای «پنج‌شنبه ۱۴۰۵/۰۵/۰۱ ساعت ۱۸:۰۰» — دقیقاً همان چیزی که فرمِ زمان‌بندیِ
 * کمپینِ drip از این تابع می‌خواهد. دو پاس برای گرفتنِ آفستِ درست (امروز
 * ایران دیگر ساعت تابستانی ندارد، پس عملاً یک پاس هم کافی است، ولی دو پاس
 * هزینه‌ای ندارد و در برابر یک تغییرِ سیاسیِ آینده هم درست می‌ماند).
 */
export function jalaliDatetimeToUtc(jy: number, jm: number, jd: number, hour: number, minute: number): string {
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  const wallUtcMs = Date.UTC(gy, gm - 1, gd, hour, minute, 0);
  let utcMs = wallUtcMs;
  for (let i = 0; i < 2; i++) {
    utcMs = wallUtcMs - tehranOffsetMinutesAt(utcMs) * 60_000;
  }
  return new Date(utcMs).toISOString();
}

/** رشته‌ی ISO (UTC یا هر timezoneی دیگر) → (سال شمسی, ماه, روز, ساعت, دقیقه) به وقت تهران. */
export function utcToJalaliDatetime(
  isoUtc: string
): { jy: number; jm: number; jd: number; hour: number; minute: number } {
  const utcMs = new Date(isoUtc).getTime();
  const parts = TEHRAN_OFFSET_FORMATTER.formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const [jy, jm, jd] = gregorianToJalali(get("year"), get("month"), get("day"));
  return { jy, jm, jd, hour: get("hour") % 24, minute: get("minute") };
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
