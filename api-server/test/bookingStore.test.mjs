/**
 * test/bookingStore.test.mjs — IRFORGE_PROMPT_V3 Phase 17
 *
 * Exercises lib/bookingStore.ts (the website's schedule/exception/
 * reservation data layer for the booking plugin) against the fake
 * `botConfig.sheetLayer` — the same in-memory-sheet harness
 * test/botPanels.test.mjs uses, per that module's own doc comment: "تست‌ها
 * یک لایه‌ی جعلی روی همین شیء Object.assign می‌کنند".
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
delete process.env.BOT_CACHE_DATABASE_URL;
delete process.env.BUSINESS_DATABASE_URL;

const botConfig = await import("../src/lib/botConfig.ts");
const store = await import("../src/lib/bookingStore.ts");

const SID = "SHEET_TEST_BOOKING";

/**
 * availabilityForRange() filters out anything at or before "now" (minute
 * precision — see bookingStore.ts's `nowMinute`), so a hardcoded calendar
 * date decays into a false failure the moment real time passes it — exactly
 * what happened to "2026-08-25" here. A Tuesday at least a week out is
 * never "already passed" no matter which real-world day/hour this suite runs.
 */
function nextTuesday(minDaysAhead = 7) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + minDaysAhead);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1); // Sunday=0 ... Tuesday=2
  return d.toISOString().slice(0, 10);
}

const TEST_DATE = nextTuesday();
const TEST_DATE_NEXT_DAY = (() => {
  const d = new Date(`${TEST_DATE}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();

/** Same in-memory fake sheet as botPanels.test.mjs, minus the parts this
 * file doesn't need. */
function installSheet(initial = {}) {
  const tabs = new Map();
  for (const [tab, rows] of Object.entries(initial)) tabs.set(tab, new Map(Object.entries(rows)));

  Object.assign(botConfig.sheetLayer, {
    async readTabRows(_sid, tab) {
      const rows = tabs.get(tab);
      if (!rows) return [];
      return [...rows.entries()].map(([key, value]) => ({ key, value, raw: false }));
    },
    async upsertRow(_sid, tab, key, value) {
      if (!tabs.has(tab)) tabs.set(tab, new Map());
      const rows = tabs.get(tab);
      const created = !rows.has(key);
      rows.set(key, JSON.parse(JSON.stringify(value)));
      return { created };
    },
    async deleteRow(_sid, tab, key) {
      const rows = tabs.get(tab);
      if (!rows || !rows.has(key)) return false;
      rows.delete(key);
      return true;
    },
    async listTabs() {
      return [...tabs.keys()];
    },
  });
  return tabs;
}

// botCacheBust.js's bustTabCache hits Postgres directly; short-circuit it
// for these tests the same way botPanels.test.mjs implicitly relies on
// (no BOT_CACHE_DATABASE_URL configured -> it already no-ops there), but
// make it explicit here since this file also asserts write behavior.

// ── برنامه‌ی کاری ────────────────────────────────────────────────────────

test("getSchedule falls back to defaults when nothing is saved", async () => {
  installSheet();
  const schedule = await store.getSchedule(SID);
  assert.equal(schedule.slot_minutes, store.DEFAULT_SCHEDULE.slot_minutes);
  assert.deepEqual(schedule.week, {});
});

test("saveSchedule persists and getSchedule reflects it afterward", async () => {
  installSheet();
  await store.saveSchedule(SID, { slot_minutes: 45, week: { tuesday: [{ from: "09:00", to: "12:00" }] } });
  const schedule = await store.getSchedule(SID);
  assert.equal(schedule.slot_minutes, 45);
  assert.deepEqual(schedule.week.tuesday, [{ from: "09:00", to: "12:00" }]);
  // untouched fields still fall back to defaults
  assert.equal(schedule.default_capacity, store.DEFAULT_SCHEDULE.default_capacity);
});

test("parseScheduleInput rejects an unknown weekday", () => {
  assert.throws(() => store.parseScheduleInput({ week: { someday: [] } }), /bad_weekday|BotConfigError/);
});

test("parseScheduleInput rejects a malformed time window", () => {
  assert.throws(() => store.parseScheduleInput({ week: { monday: [{ from: "9am", to: "18:00" }] } }));
});

test("parseScheduleInput rejects a negative slot_minutes", () => {
  assert.throws(() => store.parseScheduleInput({ slot_minutes: 0 }));
});

test("parseScheduleInput accepts a fully valid body", () => {
  const parsed = store.parseScheduleInput({
    week: { friday: [{ from: "10:00", to: "14:00" }] },
    slot_minutes: 30,
    daily_cap: 10,
    timezone: "Asia/Tehran",
  });
  assert.equal(parsed.slot_minutes, 30);
  assert.equal(parsed.daily_cap, 10);
  assert.deepEqual(parsed.week.friday, [{ from: "10:00", to: "14:00" }]);
});

// ── استثناها ─────────────────────────────────────────────────────────────

test("setException then getException round-trips", async () => {
  installSheet();
  await store.setException(SID, "2026-08-29", { closed: true, note: "تعطیل رسمی" });
  const exc = await store.getException(SID, "2026-08-29");
  assert.equal(exc.closed, true);
  assert.equal(exc.note, "تعطیل رسمی");
});

test("setException rejects a malformed date", async () => {
  installSheet();
  await assert.rejects(() => store.setException(SID, "29-08-2026", { closed: true }));
});

test("listExceptions returns all of them sorted by date", async () => {
  installSheet();
  await store.setException(SID, "2026-09-01", { closed: true });
  await store.setException(SID, "2026-08-29", { closed: true });
  const dates = (await store.listExceptions(SID)).map((e) => e.date);
  assert.deepEqual(dates, ["2026-08-29", "2026-09-01"]);
});

test("deleteException removes it", async () => {
  installSheet();
  await store.setException(SID, "2026-08-29", { closed: true });
  assert.equal(await store.deleteException(SID, "2026-08-29"), true);
  assert.equal(await store.getException(SID, "2026-08-29"), null);
});

// ── موجودی مشتق‌شده ──────────────────────────────────────────────────────

test("availabilityForRange reflects the saved schedule for each date in range", async () => {
  installSheet();
  await store.saveSchedule(SID, {
    week: { tuesday: [{ from: "09:00", to: "11:00" }] },
    slot_minutes: 60,
  });
  const slots = await store.availabilityForRange(SID, TEST_DATE, 2); // Tue, Wed
  assert.deepEqual(
    slots[TEST_DATE].map((s) => s.start),
    [`${TEST_DATE}T09:00`, `${TEST_DATE}T10:00`],
  );
  assert.deepEqual(slots[TEST_DATE_NEXT_DAY], []); // Wednesday not in the week schedule
});

test("availabilityForRange honors a closed exception on one date only", async () => {
  installSheet();
  await store.saveSchedule(SID, { week: { tuesday: [{ from: "09:00", to: "11:00" }] }, slot_minutes: 60 });
  await store.setException(SID, TEST_DATE, { closed: true });
  const slots = await store.availabilityForRange(SID, TEST_DATE, 1);
  assert.deepEqual(slots[TEST_DATE], []);
});

test("availabilityForRange excludes seats already booked on an existing slot row", async () => {
  installSheet({
    booking_slots: {
      slot_1: { starts_at: `${TEST_DATE}T09:00`, capacity: 1, booked_count: 1, is_active: true },
    },
  });
  await store.saveSchedule(SID, { week: { tuesday: [{ from: "09:00", to: "10:00" }] }, slot_minutes: 60 });
  const slots = await store.availabilityForRange(SID, TEST_DATE, 1);
  assert.deepEqual(slots[TEST_DATE], []); // fully booked -> hidden
});

test("availabilityForRange rejects a malformed start date", async () => {
  installSheet();
  await assert.rejects(() => store.availabilityForRange(SID, "not-a-date", 1));
});

// ── رزروها ───────────────────────────────────────────────────────────────

function seedReservationFixture() {
  return installSheet({
    booking_slots: {
      slot_1: { starts_at: "2026-08-25T09:00", capacity: 1, booked_count: 1, is_active: true },
    },
    booking_reservations: {
      rsv_1: { slot_id: "slot_1", service_id: "svc_1", user_id: "u1", status: "confirmed", created_at: "2026-08-20T00:00:00Z" },
    },
  });
}

test("listReservations / getReservation expose the id from the sheet key", async () => {
  seedReservationFixture();
  const all = await store.listReservations(SID);
  assert.equal(all.length, 1);
  assert.equal(all[0].id, "rsv_1");

  const one = await store.getReservation(SID, "rsv_1");
  assert.equal(one.status, "confirmed");
});

test("cancelReservation frees the linked slot's booked_count", async () => {
  const tabs = seedReservationFixture();
  const updated = await store.cancelReservation(SID, "rsv_1");
  assert.equal(updated.status, "canceled");
  assert.ok(updated.canceled_at);
  assert.equal(tabs.get("booking_slots").get("slot_1").booked_count, 0);
});

test("cancelReservation is idempotent on an already-canceled reservation", async () => {
  const tabs = seedReservationFixture();
  await store.cancelReservation(SID, "rsv_1");
  await store.cancelReservation(SID, "rsv_1"); // second call must not go negative
  assert.equal(tabs.get("booking_slots").get("slot_1").booked_count, 0);
});

test("cancelReservation 404s on an unknown id", async () => {
  seedReservationFixture();
  await assert.rejects(() => store.cancelReservation(SID, "rsv_missing"), /پیدا نشد/);
});

test("setReservationStatus routes a 'canceled' target through cancelReservation (frees the seat)", async () => {
  const tabs = seedReservationFixture();
  await store.setReservationStatus(SID, "rsv_1", "canceled");
  assert.equal(tabs.get("booking_slots").get("slot_1").booked_count, 0);
});

test("setReservationStatus rejects an unknown status", async () => {
  seedReservationFixture();
  await assert.rejects(() => store.setReservationStatus(SID, "rsv_1", "not_a_status"));
});

test("setReservationStatus updates a non-canceled status directly", async () => {
  seedReservationFixture();
  const updated = await store.setReservationStatus(SID, "rsv_1", "done");
  assert.equal(updated.status, "done");
});

test("markNoShow flags the reservation without touching slot capacity", async () => {
  const tabs = seedReservationFixture();
  const updated = await store.markNoShow(SID, "rsv_1");
  assert.equal(updated.no_show, true);
  assert.equal(updated.status, "done");
  assert.equal(tabs.get("booking_slots").get("slot_1").booked_count, 1); // untouched
});
