/**
 * lib/schoolRepSchedule.ts — منطقِ خالصِ (بدونِ DB/تلگرام) «دانش‌آموزِ منتخب»:
 * تاریخ (جلالی/میلادی/نسبی)، محاسبهٔ فاصلهٔ روز، اینکه امروز باید یادآوری رفت یا نه، و متنِ پیامِ گروه.
 * جدا نگه داشته شده تا بدونِ هیچ زیرساختی تست شود (test/schoolRepSchedule.test.mjs).
 * همهٔ تاریخ‌ها رشتهٔ `YYYY-MM-DD` به وقتِ تهران‌اند؛ هیچ‌جا از Date محلیِ سرور استفاده نمی‌شود.
 */

export const REP_KINDS = ["assignment", "exam", "reminder"] as const;
export type RepKind = (typeof REP_KINDS)[number];
export const REP_KIND_FA: Record<RepKind, string> = { assignment: "تکلیف", exam: "امتحان", reminder: "یادآوری" };
export const REP_KIND_ICON: Record<RepKind, string> = { assignment: "📝", exam: "🧪", reminder: "🔔" };

/** روزهایِ مجازِ «چند روز قبل» برایِ یادآوری (۰ = همان روز). */
export const REMIND_DAY_OPTIONS = [7, 3, 2, 1, 0] as const;
export const DEFAULT_REMIND_DAYS = [3, 1];
export const MAX_AHEAD_DAYS = 370;

const WEEK = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export const faNum = (n: number | string) => String(n).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);

/** ارقامِ فارسی/عربی → لاتین. */
export function normalizeDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

// ─── تبدیلِ جلالی ↔ میلادی (الگوریتمِ استانداردِ jalaali) ────────────────────────
const div = (a: number, b: number) => Math.trunc(a / b);
const mod = (a: number, b: number) => a - Math.trunc(a / b) * b;
const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

function jalCal(jy: number, withoutLeap = false): { gy: number; march: number; leap: number } {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;
  if (jy < jp || jy >= BREAKS[bl - 1]) throw new Error("invalid jalaali year");
  for (let i = 1; i < bl; i++) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (withoutLeap) return { gy, march, leap: 0 };
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { gy, march, leap };
}
function g2d(gy: number, gm: number, gd: number): number {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}
function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}
function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy, true);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}
function d2j(jdn: number): { jy: number; jm: number; jd: number } {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** جلالی → «YYYY-MM-DD» میلادی؛ null اگر تاریخِ جلالیِ نامعتبر باشد (مثلاً ۳۱ اسفند در سالِ غیرکبیسه). */
export function jalaliToIso(jy: number, jm: number, jd: number): string | null {
  try {
    if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
    const g = d2g(j2d(jy, jm, jd));
    const back = d2j(g2d(g.gy, g.gm, g.gd));
    if (back.jy !== jy || back.jm !== jm || back.jd !== jd) return null;
    return iso(g.gy, g.gm, g.gd);
  } catch { return null; }
}
/** «YYYY-MM-DD» میلادی → {jy,jm,jd}. */
export function isoToJalali(isoDate: string): { jy: number; jm: number; jd: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  try { return d2j(g2d(Number(m[1]), Number(m[2]), Number(m[3]))); } catch { return null; }
}
export function jalaliString(isoDate: string): string {
  const j = isoToJalali(isoDate);
  return j ? `${faNum(j.jy)}/${faNum(pad(j.jm))}/${faNum(pad(j.jd))}` : isoDate;
}

// ─── حساب روی رشتهٔ تاریخ ───────────────────────────────────────────────────
function utcMs(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
export function addDays(isoDate: string, n: number): string {
  const dt = new Date(utcMs(isoDate) + n * 86_400_000);
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
/** due − today به روز (مثبت = آینده). */
export function daysBetween(todayIso: string, dueIso: string): number {
  return Math.round((utcMs(dueIso) - utcMs(todayIso)) / 86_400_000);
}
/** نامِ روزِ هفته با قراردادِ سایت (شنبه=۰). */
export function weekdayFa(isoDate: string): string {
  const js = new Date(utcMs(isoDate)).getUTCDay(); // 0=Sun
  return WEEK[(js + 1) % 7];
}

export type ParsedDate = { ok: true; iso: string } | { ok: false; reason: "invalid" | "past" | "far" };

/**
 * ورودیِ آزادِ دانش‌آموز → تاریخ. پشتیبانی: «امروز/فردا/پس‌فردا»، «۳ روز دیگر»، «۲ هفته دیگر»،
 * «۱۴۰۵/۰۸/۲۰» (جلالی؛ جداکننده / - .)، «2026-10-20» (میلادی). گذشته و بیش از ۳۷۰ روز بعد رد می‌شود.
 */
export function parseUserDate(input: string, todayIso: string): ParsedDate {
  const s = normalizeDigits(String(input ?? "")).replace(/\u200c/g, " ").replace(/\s+/g, " ").trim();
  let target: string | null = null;

  if (/^امروز$/.test(s)) target = todayIso;
  else if (/^فردا$/.test(s)) target = addDays(todayIso, 1);
  else if (/^پس ?فردا$/.test(s)) target = addDays(todayIso, 2);
  else {
    const rel = /^(\d{1,3}) ?(روز|هفته) ?(دیگر|بعد)?$/.exec(s);
    if (rel) target = addDays(todayIso, Number(rel[1]) * (rel[2] === "هفته" ? 7 : 1));
    else {
      const m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/.exec(s);
      if (m) {
        const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
        if (y >= 1300 && y <= 1500) target = jalaliToIso(y, mo, d);
        else if (y >= 1900 && y <= 2200) { const t = iso(y, mo, d); target = isValidIsoDate(t) ? t : null; }
      }
    }
  }
  if (!target || !isValidIsoDate(target)) return { ok: false, reason: "invalid" };
  const diff = daysBetween(todayIso, target);
  if (diff < 0) return { ok: false, reason: "past" };
  if (diff > MAX_AHEAD_DAYS) return { ok: false, reason: "far" };
  return { ok: true, iso: target };
}

// ─── یادآوری ────────────────────────────────────────────────────────────────
export function normalizeRemindDays(days: unknown): number[] {
  const arr = Array.isArray(days) ? days : [];
  const set = new Set<number>();
  for (const d of arr) { const n = Number(d); if ((REMIND_DAY_OPTIONS as readonly number[]).includes(n)) set.add(n); }
  return [...set].sort((a, b) => b - a);
}
/** امروز باید برایِ این مورد یادآوری رفت؟ (فاصلهٔ امروز تا موعد دقیقاً یکی از روزهایِ انتخابی باشد.) */
export function reminderDueToday(todayIso: string, dueIso: string, remindDays: number[]): number | null {
  const diff = daysBetween(todayIso, dueIso);
  return remindDays.includes(diff) ? diff : null;
}
export function whenFa(diff: number): string {
  if (diff <= 0) return "امروز";
  if (diff === 1) return "فردا";
  if (diff === 2) return "پس‌فردا";
  return `${faNum(diff)} روز دیگر`;
}

const esc = (t: unknown) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildReminderText(i: { kind: RepKind; title: string; dueDate: string; diff: number; className: string; repName: string }): string {
  const kindFa = REP_KIND_FA[i.kind] ?? "یادآوری";
  const head = i.diff <= 0 ? `${REP_KIND_ICON[i.kind]} <b>${kindFa} — امروز!</b>` : `${REP_KIND_ICON[i.kind]} <b>یادآوریِ ${kindFa}</b>`;
  return [
    head,
    "",
    `📌 ${esc(i.title)}`,
    `📅 موعد: ${weekdayFa(i.dueDate)} ${jalaliString(i.dueDate)} (${whenFa(i.diff)})`,
    `🏫 کلاس: ${esc(i.className)}`,
    `👤 ثبت‌شده توسط: ${esc(i.repName)}`,
  ].join("\n");
}

/** ساعتِ فعلی به وقتِ تهران (۰–۲۳). */
export function tehranHour(d = new Date()): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tehran", hour: "2-digit", hour12: false }).format(d);
  return Number(h) % 24;
}
/** روزِ هفته با قراردادِ سایت (شنبه=۰ … جمعه=۶) از رشتهٔ تاریخ. */
export function dowOf(isoDate: string): number {
  return (new Date(utcMs(isoDate)).getUTCDay() + 1) % 7;
}
