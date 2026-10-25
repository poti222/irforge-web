/**
 * lib/schoolReminderSchedule.ts — منطقِ خالصِ «یادآورهایِ دانش‌آموزی» (بدونِ DB/تلگرام؛ تست: test/schoolReminderSchedule.test.mjs).
 *
 * یک یادآور = پیام + «روزهایِ هفته» + «ساعت‌هایِ روز» (چندتا) + بازهٔ تاریخیِ اختیاری + روزهایِ استثنا.
 *   مثال: «هر روز به‌جز ۲ روزِ هفته، ساعتِ ۰۶:۰۰ و ۰۸:۰۰ → خودکار بزن»، «هر جمعه ۴ بار در روز → امتحان بده».
 * همه‌چیز به وقتِ تهران؛ روزِ هفته با قراردادِ سایت: شنبه=۰ … جمعه=۶. هیچ‌جا از Date محلیِ سرور استفاده نمی‌شود.
 */
import { addDays, daysBetween, dowOf, isValidIsoDate, jalaliString, normalizeDigits } from "./schoolRepSchedule";

export const WEEK_FA = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"] as const;
export const MAX_TIMES = 12;
export const MAX_MESSAGE = 1000;
export const MAX_TITLE = 80;
export const MAX_SKIP_DATES = 60;
/** اگر سرور خاموش بود، یک ساعتِ سررسیده‌شده را تا این‌قدر دقیقه دیرتر هم می‌فرستیم؛ بیشتر از آن «گذشته» حساب می‌شود. */
export const CATCH_UP_MINUTES = 45;
/** حداقل فاصلهٔ دو ساعت در یک یادآور (دقیقه) — جلوگیری از پیام‌پرانی. */
export const MIN_GAP_MINUTES = 5;

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const faNum = (n: number | string) => String(n).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
const pad = (n: number) => String(n).padStart(2, "0");

// ─── روزهایِ هفته ─────────────────────────────────────────────────────────────
export function normalizeWeekdays(input: unknown): number[] {
  const set = new Set<number>();
  for (const v of Array.isArray(input) ? input : []) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/** «همهٔ روزها به‌جز …» → فهرستِ روزها. */
export function weekdaysExcept(excluded: number[]): number[] {
  const ex = new Set(normalizeWeekdays(excluded));
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => !ex.has(d));
}

/** فهرستِ فارسیِ روزها: «شنبه، دوشنبه و چهارشنبه». */
function joinFa(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join("، ")} و ${items[items.length - 1]}`;
}

export function describeWeekdays(days: number[]): string {
  const d = normalizeWeekdays(days);
  if (d.length === 0) return "هیچ روزی";
  if (d.length === 7) return "هر روز";
  if (d.length === 1) return `هر ${WEEK_FA[d[0]]}`;
  const missing = weekdaysExcept(d);
  // وقتی «به‌جز» کوتاه‌تر و طبیعی‌تر است (۱ تا ۲ روز مستثنا).
  if (missing.length <= 2) return `هر روز به‌جز ${joinFa(missing.map((x) => WEEK_FA[x]))}`;
  return joinFa(d.map((x) => WEEK_FA[x]));
}

// ─── ساعت‌ها ──────────────────────────────────────────────────────────────────
export function isValidTime(s: unknown): s is string {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}
export const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const timeOf = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** «۶ و ۸ صبح» نه؛ فقط قالب‌هایِ ساده: `06:00`، `6`، `۶:۳۰`، `21`، `9.30`، `۰۹٫۳۰`. جداکننده: فاصله/ویرگول/و/خطِ جدید. */
export function parseTimes(input: string): { ok: true; times: string[] } | { ok: false; reason: string; bad?: string } {
  const text = normalizeDigits(String(input ?? "")).replace(/[٫٬،;؛]/g, " ").replace(/\u200c/g, " ");
  const tokens = text.split(/[\s,]+|(?:^|\s)و(?:\s|$)/).map((s) => s.trim()).filter((s) => s && s !== "و");
  if (tokens.length === 0) return { ok: false, reason: "empty" };
  const out = new Set<string>();
  for (const tok of tokens) {
    const m = /^(\d{1,2})(?:[:.](\d{1,2}))?$/.exec(tok);
    if (!m) return { ok: false, reason: "format", bad: tok };
    const h = Number(m[1]);
    const min = m[2] === undefined ? 0 : Number(m[2]);
    if (h > 23 || min > 59) return { ok: false, reason: "range", bad: tok };
    out.add(`${pad(h)}:${pad(min)}`);
  }
  const times = [...out].sort();
  if (times.length > MAX_TIMES) return { ok: false, reason: "too_many" };
  return { ok: true, times };
}

export function normalizeTimes(input: unknown): string[] {
  const set = new Set<string>();
  for (const v of Array.isArray(input) ? input : []) if (isValidTime(v)) set.add(v);
  return [...set].sort();
}

export function describeTimes(times: string[]): string {
  const t = normalizeTimes(times);
  if (t.length === 0) return "—";
  return `ساعت ${joinFa(t.map(faNum))}`;
}

// ─── اعتبارسنجیِ ورودی ────────────────────────────────────────────────────────
export interface ReminderInput {
  title?: unknown;
  message?: unknown;
  weekdays?: unknown;
  times?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  skipDates?: unknown;
  sendDm?: unknown;
  active?: unknown;
}
export interface ReminderValue {
  title: string;
  message: string;
  weekdays: number[];
  times: string[];
  startDate: string | null;
  endDate: string | null;
  skipDates: string[];
  sendDm: boolean;
  active: boolean;
}

const cleanText = (s: unknown) => String(s ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
const optDate = (v: unknown): string | null | undefined => {
  if (v === null || v === undefined || v === "") return null;
  return typeof v === "string" && isValidIsoDate(v) ? v : undefined;
};

/** `partial=true` برایِ PATCH: فیلدهایِ ندادهشده بررسی نمی‌شوند. */
export function validateReminder(input: ReminderInput, partial = false): { ok: true; value: Partial<ReminderValue> } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const v: Partial<ReminderValue> = {};

  if (!partial || input.message !== undefined) {
    const m = cleanText(input.message);
    if (m.length < 1) errors.push("متنِ پیام لازم است");
    else if (m.length > MAX_MESSAGE) errors.push(`متنِ پیام حداکثر ${faNum(MAX_MESSAGE)} نویسه`);
    else v.message = m;
  }
  if (input.title !== undefined) {
    const t = cleanText(input.title).replace(/\s+/g, " ");
    if (t.length > MAX_TITLE) errors.push(`عنوان حداکثر ${faNum(MAX_TITLE)} نویسه`);
    else v.title = t;
  } else if (!partial) v.title = "";

  if (!partial || input.weekdays !== undefined) {
    const d = normalizeWeekdays(input.weekdays);
    if (d.length === 0) errors.push("حداقل یک روزِ هفته انتخاب کنید");
    else v.weekdays = d;
  }
  if (!partial || input.times !== undefined) {
    const raw = Array.isArray(input.times) ? input.times : [];
    const t = normalizeTimes(raw);
    if (raw.length === 0) errors.push("حداقل یک ساعت لازم است (مثلاً ۰۶:۰۰)");
    else if (raw.some((x) => !isValidTime(x))) errors.push("ساعت‌ها باید به‌شکلِ HH:MM باشند");
    else if (t.length > MAX_TIMES) errors.push(`حداکثر ${faNum(MAX_TIMES)} ساعت در روز`);
    else {
      let gapOk = true;
      for (let i = 1; i < t.length; i++) if (minutesOf(t[i]) - minutesOf(t[i - 1]) < MIN_GAP_MINUTES) gapOk = false;
      if (!gapOk) errors.push(`فاصلهٔ دو ساعت حداقل ${faNum(MIN_GAP_MINUTES)} دقیقه باشد`);
      else v.times = t;
    }
  }

  if (!partial || input.startDate !== undefined) {
    const d = optDate(input.startDate);
    if (d === undefined) errors.push("تاریخِ شروع نامعتبر است"); else v.startDate = d;
  }
  if (!partial || input.endDate !== undefined) {
    const d = optDate(input.endDate);
    if (d === undefined) errors.push("تاریخِ پایان نامعتبر است"); else v.endDate = d;
  }
  if (v.startDate && v.endDate && v.endDate < v.startDate) errors.push("تاریخِ پایان نباید قبل از شروع باشد");

  if (!partial || input.skipDates !== undefined) {
    const arr = Array.isArray(input.skipDates) ? input.skipDates : [];
    const ok = [...new Set(arr.filter((x): x is string => typeof x === "string" && isValidIsoDate(x)))].sort();
    if (ok.length !== new Set(arr).size) errors.push("یکی از تاریخ‌هایِ استثنا نامعتبر است");
    else if (ok.length > MAX_SKIP_DATES) errors.push(`حداکثر ${faNum(MAX_SKIP_DATES)} روزِ استثنا`);
    else v.skipDates = ok;
  }
  if (!partial || input.sendDm !== undefined) v.sendDm = input.sendDm === undefined ? true : input.sendDm === true;
  if (!partial || input.active !== undefined) v.active = input.active === undefined ? true : input.active === true;

  return errors.length ? { ok: false, errors } : { ok: true, value: v };
}

// ─── «الان باید چه چیزی برود؟» ────────────────────────────────────────────────
export interface ScheduleLike {
  weekdays: number[];
  times: string[];
  startDate?: string | null;
  endDate?: string | null;
  skipDates?: string[] | null;
}

export function isRunDay(r: ScheduleLike, dateIso: string): boolean {
  if (!normalizeWeekdays(r.weekdays).includes(dowOf(dateIso))) return false;
  if (r.startDate && dateIso < r.startDate) return false;
  if (r.endDate && dateIso > r.endDate) return false;
  if (r.skipDates?.includes(dateIso)) return false;
  return true;
}

export interface TehranNow { dateIso: string; minutes: number; dow: number }
/** لحظهٔ `d` به وقتِ تهران (بدونِ DST؛ ایران از ۱۴۰۱ ساعتِ تابستانی ندارد و Intl هم همین را اعمال می‌کند). */
export function tehranNow(d = new Date()): TehranNow {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const dateIso = `${get("year")}-${get("month")}-${get("day")}`;
  return { dateIso, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")), dow: dowOf(dateIso) };
}

/**
 * ساعت‌هایِ «سررسیده و هنوز در پنجرهٔ جبران» برایِ امروز: ساعت ≤ الان و حداکثر `CATCH_UP_MINUTES` دقیقه قبل.
 * ارسالِ واقعی با کلیدِ یکتا (`reminder, date, time, target`) idempotent می‌شود؛ پس فراخوانیِ دوباره‌ی همین تابع خطری ندارد.
 */
export function dueSlots(r: ScheduleLike, now: TehranNow, catchUp = CATCH_UP_MINUTES): string[] {
  if (!isRunDay(r, now.dateIso)) return [];
  return normalizeTimes(r.times).filter((t) => {
    const m = minutesOf(t);
    return m <= now.minutes && now.minutes - m <= catchUp;
  });
}

/** n اجرایِ بعدیِ یادآور (برایِ پیش‌نمایشِ UI). `fromIso/fromMinutes`: اجراهایی که قبل از این لحظه‌اند نمی‌آیند. */
export function nextRuns(r: ScheduleLike, now: TehranNow, n = 5, horizonDays = 120): { date: string; time: string }[] {
  const out: { date: string; time: string }[] = [];
  const times = normalizeTimes(r.times);
  for (let i = 0; i <= horizonDays && out.length < n; i++) {
    const date = addDays(now.dateIso, i);
    if (!isRunDay(r, date)) continue;
    for (const t of times) {
      if (i === 0 && minutesOf(t) <= now.minutes) continue;
      out.push({ date, time: t });
      if (out.length >= n) break;
    }
  }
  return out;
}

/** خلاصهٔ یک‌خطیِ زمان‌بندی: «هر روز به‌جز پنجشنبه و جمعه — ساعت ۰۶:۰۰ و ۰۸:۰۰». */
export function describeSchedule(r: ScheduleLike): string {
  const parts = [`${describeWeekdays(r.weekdays)} — ${describeTimes(r.times)}`];
  if (r.startDate && r.endDate) parts.push(`از ${jalaliString(r.startDate)} تا ${jalaliString(r.endDate)}`);
  else if (r.startDate) parts.push(`از ${jalaliString(r.startDate)}`);
  else if (r.endDate) parts.push(`تا ${jalaliString(r.endDate)}`);
  return parts.join(" · ");
}

const esc = (t: unknown) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** متنِ نهاییِ پیامِ دانش‌آموز (HTMLِ تلگرام). className خالی = یادآورِ کلِ مدرسه. */
export function buildReminderMessage(message: string, className: string | null): string {
  return [`🔔 <b>یادآوری</b>${className ? ` — ${esc(className)}` : ""}`, "", esc(message)].join("\n");
}

export { daysBetween };
