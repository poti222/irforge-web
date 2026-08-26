/**
 * lib/bookingStore.ts — IRFORGE_PROMPT_V3 Phase 17
 * ─────────────────────────────────────────────────────────────────────────────
 * Website-side data layer for the booking plugin's working-hours schedule,
 * per-date exceptions, derived availability, and reservation management —
 * the TypeScript sibling of `plugins/booking/domain.py`. Built on
 * `botConfig.ts`'s generic entity helpers (`getEntity`/`putEntity`/
 * `listEntity`), the same layer every other bot-admin route uses, so this
 * follows the same rules: never rewrite a whole tab, bust the bot cache
 * after every write (handled inside `putEntity`/`removeEntity` already),
 * and check `assertSheetsAuthoritative()` before writing.
 *
 * What this module deliberately does NOT do: create a reservation. The
 * bot is the only place a customer actually books a slot (`reserve_slot()`
 * in domain.py) — the website only manages the schedule/exceptions and
 * reviews/edits reservations the bot already created (confirm, reject,
 * cancel, mark no-show, export). That asymmetry mirrors
 * `pluginCollections.ts`'s pre-existing `noCreate` convention for the old
 * `booking-reservations` generic collection this replaces.
 */
import {
  getEntity, putEntity, listEntity, removeEntity, assertSheetsAuthoritative, BotConfigError,
} from "./botConfig.js";
import { nowIso } from "./botTypes.js";
import {
  computeAvailableSlots, WEEKDAYS, type AvailableSlot, type ExistingSlot, type Weekday, type WeekSchedule,
} from "./bookingAvailability.js";

export type { WeekSchedule, Weekday };

const SCHEDULE_TAB = "booking_schedule";
const EXCEPTIONS_TAB = "booking_exceptions";
const SLOTS_TAB = "booking_slots";
const RESERVATIONS_TAB = "booking_reservations";
const SCHEDULE_ID = "default";

export interface BookingSchedule {
  id: string;
  week: WeekSchedule;
  slot_minutes: number;
  buffer_minutes: number;
  lead_time_minutes: number;
  daily_cap: number;
  default_capacity: number;
  horizon_days: number;
  timezone: string;
  cancel_cutoff_hours: number;
  created_at?: string;
  updated_at?: string;
}

export const DEFAULT_SCHEDULE: Omit<BookingSchedule, "id"> = {
  week: {},
  slot_minutes: 60,
  buffer_minutes: 0,
  lead_time_minutes: 0,
  daily_cap: 0,
  default_capacity: 1,
  horizon_days: 30,
  timezone: "Asia/Tehran",
  cancel_cutoff_hours: 0,
};

export interface BookingException {
  closed?: boolean;
  windows?: Array<{ from: string; to: string }>;
  capacity?: number | null;
  note?: string;
  created_at?: string;
  updated_at?: string;
}

export interface BookingSlot {
  id?: string;
  service_id?: string;
  starts_at: string;
  ends_at?: string;
  capacity: number;
  booked_count: number;
  is_active?: boolean;
}

export const STATUSES = ["pending", "confirmed", "canceled", "done", "overbooked"] as const;
export type ReservationStatus = (typeof STATUSES)[number];

export interface BookingReservation {
  id: string;
  slot_id: string;
  service_id: string;
  user_id: string;
  username?: string;
  status: ReservationStatus | string;
  customer_name?: string;
  customer_phone?: string;
  // IRFORGE_PROMPT_V3 Phase 18 — اختیاری، از بات (`plugins/booking/handlers.py`ی
  // قدمِ collect location). PII مشتریه: عمداً در ستون‌های CSV
  // (`routes/booking.ts`) نیست، فقط در جدولِ خودِ سایت به ادمین نشان داده می‌شود.
  customer_lat?: number | null;
  customer_lng?: number | null;
  note?: string;
  price_paid?: number;
  no_show?: boolean;
  reminder_24h_sent_at?: string;
  reminder_2h_sent_at?: string;
  created_at?: string;
  updated_at?: string;
  canceled_at?: string;
}

// ── برنامه‌ی کاری ────────────────────────────────────────────────────────

export async function getSchedule(spreadsheetId: string): Promise<BookingSchedule> {
  const record = await getEntity<Partial<BookingSchedule>>(spreadsheetId, SCHEDULE_TAB, SCHEDULE_ID);
  return { id: SCHEDULE_ID, ...DEFAULT_SCHEDULE, ...(record ?? {}) };
}

const HHMM = /^\d{2}:\d{2}$/;

function parseWindows(day: string, raw: unknown): Array<{ from: string; to: string }> {
  if (!Array.isArray(raw)) throw new BotConfigError(400, `بازه‌های «${day}» باید آرایه باشند.`, "bad_windows");
  return raw.map((w: any) => {
    if (!w || typeof w.from !== "string" || typeof w.to !== "string" || !HHMM.test(w.from) || !HHMM.test(w.to)) {
      throw new BotConfigError(400, `بازه‌ی نامعتبر در «${day}» — قالبِ درست HH:MM است.`, "bad_window");
    }
    return { from: w.from, to: w.to };
  });
}

/** بدنه‌ی خام PUT را به `Partial<BookingSchedule>` معتبر تبدیل می‌کند — هر
 * چیز نامعتبر ۴۰۰ می‌دهد، نه اینکه بی‌صدا نادیده گرفته شود. */
export function parseScheduleInput(body: any): Partial<BookingSchedule> {
  const out: Partial<BookingSchedule> = {};

  if (body.week !== undefined) {
    if (typeof body.week !== "object" || body.week === null || Array.isArray(body.week)) {
      throw new BotConfigError(400, "week باید یک آبجکت باشد.", "bad_week");
    }
    const week: WeekSchedule = {};
    for (const [day, windows] of Object.entries(body.week)) {
      if (!(WEEKDAYS as readonly string[]).includes(day)) {
        throw new BotConfigError(400, `روز «${day}» معتبر نیست.`, "bad_weekday");
      }
      week[day as Weekday] = parseWindows(day, windows);
    }
    out.week = week;
  }

  const numField = (key: keyof BookingSchedule, min: number) => {
    if (body[key] === undefined) return;
    const n = Number(body[key]);
    if (!Number.isFinite(n) || n < min) {
      throw new BotConfigError(400, `مقدار «${String(key)}» نامعتبر است.`, "bad_number");
    }
    (out as any)[key] = Math.trunc(n);
  };
  numField("slot_minutes", 1);
  numField("buffer_minutes", 0);
  numField("lead_time_minutes", 0);
  numField("daily_cap", 0);
  numField("default_capacity", 1);
  numField("horizon_days", 1);
  numField("cancel_cutoff_hours", 0);

  if (body.timezone !== undefined) {
    if (typeof body.timezone !== "string" || !body.timezone.trim()) {
      throw new BotConfigError(400, "timezone نامعتبر است.", "bad_timezone");
    }
    out.timezone = body.timezone.trim();
  }

  return out;
}

export async function saveSchedule(
  spreadsheetId: string,
  changes: Partial<BookingSchedule>,
): Promise<BookingSchedule> {
  await assertSheetsAuthoritative(SCHEDULE_TAB);
  const current = await getSchedule(spreadsheetId);
  const next: BookingSchedule = { ...current, ...changes, id: SCHEDULE_ID, updated_at: nowIso() };
  await putEntity(spreadsheetId, SCHEDULE_TAB, SCHEDULE_ID, next);
  return next;
}

// ── استثناها ─────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function listExceptions(
  spreadsheetId: string,
): Promise<Array<BookingException & { date: string }>> {
  const rows = await listEntity<BookingException>(spreadsheetId, EXCEPTIONS_TAB);
  return rows
    .map((r) => ({ date: r.key, ...(r.value as BookingException) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getException(spreadsheetId: string, date: string): Promise<BookingException | null> {
  return getEntity<BookingException>(spreadsheetId, EXCEPTIONS_TAB, date);
}

export async function setException(
  spreadsheetId: string,
  date: string,
  body: any,
): Promise<BookingException> {
  await assertSheetsAuthoritative(EXCEPTIONS_TAB);
  if (!DATE_RE.test(date)) throw new BotConfigError(400, "تاریخ باید به شکل YYYY-MM-DD باشد.", "bad_date");

  const closed = Boolean(body?.closed);
  const windows = body?.windows !== undefined ? parseWindows(date, body.windows) : [];
  let capacity: number | null = null;
  if (body?.capacity !== undefined && body.capacity !== null) {
    const n = Number(body.capacity);
    if (!Number.isFinite(n) || n < 1) throw new BotConfigError(400, "capacity نامعتبر است.", "bad_capacity");
    capacity = Math.trunc(n);
  }

  const existing = await getEntity<BookingException>(spreadsheetId, EXCEPTIONS_TAB, date);
  const value: BookingException = {
    closed,
    windows,
    capacity,
    note: typeof body?.note === "string" ? body.note.slice(0, 300) : "",
    created_at: existing?.created_at ?? nowIso(),
    updated_at: nowIso(),
  };
  await putEntity(spreadsheetId, EXCEPTIONS_TAB, date, value);
  return value;
}

export async function deleteException(spreadsheetId: string, date: string): Promise<boolean> {
  await assertSheetsAuthoritative(EXCEPTIONS_TAB);
  return removeEntity(spreadsheetId, EXCEPTIONS_TAB, date);
}

// ── موجودی مشتق‌شده ──────────────────────────────────────────────────────

function isoDateNDaysAfter(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** دقیقاً همان چیزی که `plugins/booking/domain.py::available_slots` برای
 * یک تاریخ می‌سازد، ولی برای یک بازه‌ی چندروزه یک‌جا — تقویمِ هفتگیِ سایت
 * هفت درخواست جدا نمی‌زند. */
export async function availabilityForRange(
  spreadsheetId: string,
  startDate: string,
  days: number,
): Promise<Record<string, AvailableSlot[]>> {
  if (!DATE_RE.test(startDate)) throw new BotConfigError(400, "start باید به شکل YYYY-MM-DD باشد.", "bad_date");

  const schedule = await getSchedule(spreadsheetId);
  const slotRows = await listEntity<BookingSlot>(spreadsheetId, SLOTS_TAB);
  const activeSlots = slotRows
    .map((r) => r.value as BookingSlot)
    .filter((s) => s && s.is_active !== false);

  const nowMinute = new Date().toISOString().slice(0, 16);
  const out: Record<string, AvailableSlot[]> = {};

  for (let i = 0; i < days; i++) {
    const date = isoDateNDaysAfter(startDate, i);
    const exception = await getException(spreadsheetId, date);

    const existing: ExistingSlot[] = [];
    const bookedCounts: Record<string, number> = {};
    for (const slot of activeSlots) {
      const startsAt = String(slot.starts_at || "");
      if (!startsAt.startsWith(date)) continue;
      existing.push({ start: startsAt, end: slot.ends_at || startsAt, capacity: slot.capacity });
      bookedCounts[startsAt] = Number(slot.booked_count || 0);
    }

    out[date] = computeAvailableSlots({
      date,
      week: schedule.week,
      slot_minutes: schedule.slot_minutes,
      buffer_minutes: schedule.buffer_minutes,
      lead_time_minutes: schedule.lead_time_minutes,
      daily_cap: schedule.daily_cap,
      default_capacity: schedule.default_capacity,
      now: nowMinute,
      exception,
      existing_slots: existing,
      booked_counts: bookedCounts,
    });
  }
  return out;
}

// ── رزروها ───────────────────────────────────────────────────────────────

export async function listReservations(spreadsheetId: string): Promise<BookingReservation[]> {
  const rows = await listEntity<BookingReservation>(spreadsheetId, RESERVATIONS_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => ({ ...(r.value as BookingReservation), id: r.key }));
}

export async function getReservation(spreadsheetId: string, id: string): Promise<BookingReservation | null> {
  const value = await getEntity<BookingReservation>(spreadsheetId, RESERVATIONS_TAB, id);
  return value ? { ...value, id } : null;
}

/** لغو + آزادکردن ظرفیتِ بازه — همتای `plugins/booking/domain.py::cancel(by_admin=True)`.
 * سایت همیشه با بای‌پسِ ادمین لغو می‌کند: سقفِ لغوِ مشتری معنایی سمتِ ادمین ندارد. */
export async function cancelReservation(
  spreadsheetId: string,
  reservationId: string,
): Promise<BookingReservation> {
  await assertSheetsAuthoritative(RESERVATIONS_TAB);
  const reservation = await getReservation(spreadsheetId, reservationId);
  if (!reservation) throw new BotConfigError(404, "این رزرو پیدا نشد.", "reservation_not_found");
  if (reservation.status === "canceled") return reservation;

  const next: BookingReservation = {
    ...reservation,
    status: "canceled",
    canceled_at: nowIso(),
    updated_at: nowIso(),
  };
  await putEntity(spreadsheetId, RESERVATIONS_TAB, reservationId, next);

  const slot = await getEntity<BookingSlot>(spreadsheetId, SLOTS_TAB, reservation.slot_id);
  if (slot) {
    await putEntity(spreadsheetId, SLOTS_TAB, reservation.slot_id, {
      ...slot,
      booked_count: Math.max(0, Number(slot.booked_count || 0) - 1),
      updated_at: nowIso(),
    });
  }
  return next;
}

export async function setReservationStatus(
  spreadsheetId: string,
  reservationId: string,
  status: string,
): Promise<BookingReservation> {
  if (!(STATUSES as readonly string[]).includes(status)) {
    throw new BotConfigError(400, `وضعیت «${status}» معتبر نیست.`, "bad_status");
  }
  if (status === "canceled") return cancelReservation(spreadsheetId, reservationId);

  await assertSheetsAuthoritative(RESERVATIONS_TAB);
  const reservation = await getReservation(spreadsheetId, reservationId);
  if (!reservation) throw new BotConfigError(404, "این رزرو پیدا نشد.", "reservation_not_found");

  const next: BookingReservation = { ...reservation, status: status as ReservationStatus, updated_at: nowIso() };
  await putEntity(spreadsheetId, RESERVATIONS_TAB, reservationId, next);
  return next;
}

/** مشتری نیامد — همتای `plugins/booking/domain.py::mark_no_show`: جا آزاد
 * نمی‌شود (وقتش گذشته)، فقط پرچم می‌خورد. */
export async function markNoShow(spreadsheetId: string, reservationId: string): Promise<BookingReservation> {
  await assertSheetsAuthoritative(RESERVATIONS_TAB);
  const reservation = await getReservation(spreadsheetId, reservationId);
  if (!reservation) throw new BotConfigError(404, "این رزرو پیدا نشد.", "reservation_not_found");

  const next: BookingReservation = { ...reservation, no_show: true, status: "done", updated_at: nowIso() };
  await putEntity(spreadsheetId, RESERVATIONS_TAB, reservationId, next);
  return next;
}
