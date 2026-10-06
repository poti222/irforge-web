import type { TimetableSlot } from "@/lib/schools-api";

/** ارقامِ فارسی/عربی → لاتین. */
export function toLatinDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** "8:30" / "۰۸:۳۰" / "0830" → "08:30"؛ نامعتبر → null (همان قاعده‌یِ سرور). */
export function normalizeTime(raw: string): string | null {
  const s = toLatinDigits(raw).trim().replace(/[٫.،]/g, ":");
  const m = /^(\d{1,2}):(\d{2})$/.exec(s) ?? /^(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
export const fromMinutes = (min: number): string => {
  const c = Math.max(0, Math.min(23 * 60 + 59, min));
  return `${String(Math.floor(c / 60)).padStart(2, "0")}:${String(c % 60).padStart(2, "0")}`;
};

/** نمایشِ ساعت با ارقامِ فارسی در UI فارسی. */
export function displayTime(hhmm: string, fa: boolean): string {
  return fa ? hhmm.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]) : hhmm;
}

/** ۰=شنبه … ۶=جمعه؛ Date.getDay(): ۰=یک‌شنبه … ۶=شنبه. */
export const iranianDayIndex = (d: Date = new Date()): number => (d.getDay() + 1) % 7;

/** زنگِ جاری و زنگِ بعدیِ امروز (برایِ نشانگرِ «الان/بعدی»). */
export function nowAndNext(slots: TimetableSlot[], now: Date = new Date()): { current: TimetableSlot | null; next: TimetableSlot | null } {
  const day = iranianDayIndex(now);
  const min = now.getHours() * 60 + now.getMinutes();
  const today = slots.filter((s) => s.dayOfWeek === day).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const current = today.find((s) => toMinutes(s.startTime) <= min && min < toMinutes(s.endTime)) ?? null;
  const next = today.find((s) => toMinutes(s.startTime) > min) ?? null;
  return { current, next };
}
