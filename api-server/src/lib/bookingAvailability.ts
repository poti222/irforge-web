/**
 * lib/bookingAvailability.ts — IRFORGE_PROMPT_V3 Phase 17
 *
 * Independent TypeScript port of bot/plugins/booking/availability.py's
 * compute_available_slots(). Two separate implementations of the exact
 * same derivation exist (one in the Python bot, one here) because the
 * website's own calendar/reservation UI needs the identical answer the
 * bot gives its users — the only way to keep two independent
 * implementations honest is to test both against the same fixture data:
 * test/fixtures/booking_availability_cases.json here, and
 * bot/tests/fixtures/booking_availability_cases.json on the bot side —
 * two files because these are two separate git repos, kept in sync by
 * hand (this file's header, and that one's, both say so).
 *
 * Time model: every timestamp in and out is a naive "YYYY-MM-DDTHH:MM"
 * string in whatever wall-clock frame the caller already uses (the bot
 * works in UTC wall-clock terms for booking — see the Python module's
 * docstring — so callers here should pass UTC times too, but nothing in
 * this file assumes that specifically).
 */

export interface TimeWindow {
  from: string; // "HH:MM"
  to: string; // "HH:MM"
}

export type WeekSchedule = Partial<Record<Weekday, TimeWindow[]>>;

export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export const WEEKDAYS: readonly Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const ISO_WEEKDAY_TO_NAME: Record<number, Weekday> = {
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
  6: "saturday",
  7: "sunday",
};

export interface DateException {
  closed?: boolean;
  windows?: TimeWindow[];
  capacity?: number | null;
  note?: string;
}

export interface ExistingSlot {
  start?: string;
  starts_at?: string;
  end?: string;
  capacity?: number;
}

export interface AvailableSlot {
  start: string;
  end: string;
  capacity: number;
  booked: number;
  free: number;
}

export interface ComputeAvailableSlotsInput {
  date: string;
  week: WeekSchedule;
  slot_minutes: number;
  buffer_minutes: number;
  lead_time_minutes: number;
  daily_cap: number;
  default_capacity: number;
  now: string;
  exception?: DateException | null;
  existing_slots?: ExistingSlot[] | null;
  booked_counts?: Record<string, number> | null;
}

/** "YYYY-MM-DD" -> weekday name, independent of any other numbering
 * convention used elsewhere in the codebase. */
export function weekdayNameOf(date: string): Weekday {
  const [y, m, d] = date.split("-").map(Number);
  const isoWeekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7; // Sun=0 -> 7
  return ISO_WEEKDAY_TO_NAME[isoWeekday];
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function hhmmOf(totalMinutes: number): string {
  const m = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** "YYYY-MM-DDTHH:MM" + minutes, no external date library. */
export function addMinutes(isoDatetime: string, minutes: number): string {
  const [datePart, timePart] = isoDatetime.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const total = minutesOf(timePart) + minutes;
  const extraDays = Math.floor(total / (24 * 60));
  const rem = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  if (extraDays === 0) return `${datePart}T${hhmmOf(rem)}`;
  const newDate = new Date(Date.UTC(y, m - 1, d));
  newDate.setUTCDate(newDate.getUTCDate() + extraDays);
  const iso = newDate.toISOString().slice(0, 10);
  return `${iso}T${hhmmOf(rem)}`;
}

/** Open windows for a date + its capacity override (null = "default").
 *
 * An exception always overrides the weekly schedule: `closed` means no
 * windows at all (even on a weekday that's normally open), `windows`
 * fully replaces that day's windows (not merged with the weekly
 * default) — an exception must be entirely predictable, not an
 * ambiguous blend with the weekly default. */
export function windowsForDate(
  date: string,
  week: WeekSchedule,
  exception?: DateException | null,
): [TimeWindow[], number | null] {
  if (exception) {
    if (exception.closed) return [[], exception.capacity ?? null];
    if (exception.windows && exception.windows.length > 0) {
      return [exception.windows, exception.capacity ?? null];
    }
    return [[], exception.capacity ?? null];
  }
  return [week[weekdayNameOf(date)] ?? [], null];
}

/**
 * The slots of a date that are actually bookable right now.
 *
 * Output sorted by `start`. `free === 0` means the slot is omitted
 * entirely (not shown disabled) — per spec, a full slot must be hidden,
 * not shown greyed out.
 *
 * Steps: 1) open windows for the date (exception-aware) 2) cut into
 * `slot_minutes` + `buffer_minutes` steps 3) drop anything inside
 * `lead_time_minutes` 4) union with manually-made slots on the same
 * date (legacy) 5) apply capacity/existing bookings 6) apply the daily
 * cap.
 */
export function computeAvailableSlots(input: ComputeAvailableSlotsInput): AvailableSlot[] {
  const {
    date,
    week,
    slot_minutes: slotMinutes,
    buffer_minutes: bufferMinutes,
    lead_time_minutes: leadTimeMinutes,
    daily_cap: dailyCap,
    default_capacity: defaultCapacity,
    now,
    exception = null,
    existing_slots: existingSlots = [],
    booked_counts: bookedCounts = {},
  } = input;

  const [windows, capacityOverride] = windowsForDate(date, week, exception);
  const capacity = capacityOverride ?? defaultCapacity;
  const step = Math.max(1, Math.trunc(slotMinutes)) + Math.max(0, Math.trunc(bufferMinutes));
  const leadCutoff = leadTimeMinutes ? addMinutes(now, leadTimeMinutes) : now;

  const slots = new Map<string, { start: string; end: string; capacity: number }>();
  for (const window of windows) {
    const startMin = minutesOf(window.from);
    const endMin = minutesOf(window.to);
    let cursor = startMin;
    while (cursor + slotMinutes <= endMin) {
      const startIso = `${date}T${hhmmOf(cursor)}`;
      const endIso = `${date}T${hhmmOf(cursor + slotMinutes)}`;
      if (startIso >= leadCutoff) {
        slots.set(startIso, { start: startIso, end: endIso, capacity });
      }
      cursor += step;
    }
  }

  // Legacy hand-made slots on this same date — union, not replacement;
  // they keep their own capacity.
  for (const row of existingSlots ?? []) {
    const startIso = String(row.start ?? row.starts_at ?? "");
    if (!startIso.startsWith(date)) continue;
    if (startIso < leadCutoff) continue;
    if (!slots.has(startIso)) {
      slots.set(startIso, {
        start: startIso,
        end: row.end || startIso,
        capacity: Number(row.capacity || defaultCapacity),
      });
    }
  }

  const counts = bookedCounts ?? {};
  const dayTotalBooked = Object.values(counts).reduce((sum, v) => sum + Number(v), 0);
  const remainingDayCapacity = dailyCap ? Math.max(0, dailyCap - dayTotalBooked) : null;

  const out: AvailableSlot[] = [];
  for (const startIso of Array.from(slots.keys()).sort()) {
    const slot = slots.get(startIso)!;
    const booked = Number(counts[startIso] ?? 0);
    let free = Math.max(0, slot.capacity - booked);
    if (remainingDayCapacity !== null) free = Math.min(free, remainingDayCapacity);
    if (free <= 0) continue;
    out.push({ ...slot, booked, free });
  }
  return out;
}

/** Cheap date-level availability check for calendar buttons — doesn't
 * compute the slots themselves (not worth the cost for every day of a
 * month view). Returns [available, reason] — an empty reason means
 * available. */
export function isDateAvailable(
  date: string,
  opts: { week: WeekSchedule; exception?: DateException | null; horizonDays: number; today: string },
): [boolean, string] {
  const { week, exception = null, horizonDays, today } = opts;
  if (date < today) return [false, "گذشته"];
  const [ty, tm, td] = today.split("-").map(Number);
  const horizonEnd = new Date(Date.UTC(ty, tm - 1, td));
  horizonEnd.setUTCDate(horizonEnd.getUTCDate() + horizonDays);
  const horizonEndIso = horizonEnd.toISOString().slice(0, 10);
  if (date > horizonEndIso) return [false, "خارج از بازه‌ی رزرو"];
  const [windows] = windowsForDate(date, week, exception);
  if (windows.length === 0) return [false, "تعطیل"];
  return [true, ""];
}
