import test from "node:test";
import assert from "node:assert/strict";
const S = await import("../src/lib/schoolReminderSchedule.ts");

test("weekdays: normalize + except + describe", () => {
  assert.deepEqual(S.normalizeWeekdays([6, 0, 0, "3", 9, -1, "x"]), [0, 3, 6]);
  assert.deepEqual(S.weekdaysExcept([5, 6]), [0, 1, 2, 3, 4]);
  assert.equal(S.describeWeekdays([0, 1, 2, 3, 4, 5, 6]), "هر روز");
  assert.equal(S.describeWeekdays(S.weekdaysExcept([6])), "هر روز به‌جز جمعه");
  assert.equal(S.describeWeekdays(S.weekdaysExcept([5, 6])), "هر روز به‌جز پنجشنبه و جمعه");
  assert.equal(S.describeWeekdays([6]), "هر جمعه");
  assert.equal(S.describeWeekdays([0, 2, 5]), "شنبه، دوشنبه و پنجشنبه");
  assert.equal(S.describeWeekdays([]), "هیچ روزی");
});

test("parseTimes accepts Persian digits, separators and short forms", () => {
  assert.deepEqual(S.parseTimes("۰۶:۰۰ ۰۸:۰۰"), { ok: true, times: ["06:00", "08:00"] });
  assert.deepEqual(S.parseTimes("6 و 8"), { ok: true, times: ["06:00", "08:00"] });
  assert.deepEqual(S.parseTimes("21"), { ok: true, times: ["21:00"] });
  assert.deepEqual(S.parseTimes("9.30، ۱۴:۰۵"), { ok: true, times: ["09:30", "14:05"] });
  assert.deepEqual(S.parseTimes("08:00 08:00 6:00"), { ok: true, times: ["06:00", "08:00"] });
  assert.equal(S.parseTimes("25:00").ok, false);
  assert.equal(S.parseTimes("12:60").ok, false);
  assert.equal(S.parseTimes("صبح").ok, false);
  assert.equal(S.parseTimes("   ").ok, false);
  assert.equal(S.parseTimes(Array.from({ length: 13 }, (_, i) => `${i}:00`).join(" ")).reason, "too_many");
});

test("validateReminder: the three examples from the product brief are valid", () => {
  const a = S.validateReminder({ message: "خودکار بزن", weekdays: S.weekdaysExcept([5, 6]), times: ["06:00", "08:00"] });
  assert.ok(a.ok); assert.deepEqual(a.value.times, ["06:00", "08:00"]); assert.equal(a.value.active, true); assert.equal(a.value.sendDm, true);
  const b = S.validateReminder({ message: "گزارشِ کار بفرست", weekdays: [0, 1, 2, 3, 4, 5, 6], times: ["21:00"] });
  assert.ok(b.ok);
  const c = S.validateReminder({ message: "امتحان بده", weekdays: [6], times: ["09:00", "12:00", "16:00", "20:00"] });
  assert.ok(c.ok); assert.equal(c.value.times.length, 4);
});

test("validateReminder: rejects bad input", () => {
  const bad = (i) => { const r = S.validateReminder(i); assert.equal(r.ok, false); return r.errors.join("|"); };
  assert.match(bad({ message: "", weekdays: [1], times: ["06:00"] }), /متنِ پیام/);
  assert.match(bad({ message: "x".repeat(1001), weekdays: [1], times: ["06:00"] }), /حداکثر/);
  assert.match(bad({ message: "x", weekdays: [], times: ["06:00"] }), /روزِ هفته/);
  assert.match(bad({ message: "x", weekdays: [1], times: [] }), /ساعت/);
  assert.match(bad({ message: "x", weekdays: [1], times: ["6:00"] }), /HH:MM/);
  assert.match(bad({ message: "x", weekdays: [1], times: ["06:00", "06:03"] }), /فاصله/);
  assert.match(bad({ message: "x", weekdays: [1], times: ["06:00"], startDate: "2026-10-10", endDate: "2026-10-01" }), /پایان/);
  assert.match(bad({ message: "x", weekdays: [1], times: ["06:00"], startDate: "2026-13-40" }), /شروع/);
  assert.match(bad({ message: "x", weekdays: [1], times: ["06:00"], skipDates: ["nope"] }), /استثنا/);
});

test("validateReminder partial (PATCH) only checks given fields", () => {
  assert.ok(S.validateReminder({ active: false }, true).ok);
  const r = S.validateReminder({ times: ["07:00", "07:30"] }, true);
  assert.ok(r.ok); assert.deepEqual(Object.keys(r.value), ["times"]);
  assert.equal(S.validateReminder({ weekdays: [] }, true).ok, false);
});

test("tehranNow converts correctly (UTC+3:30, no DST)", () => {
  const n = S.tehranNow(new Date("2026-10-24T02:30:00Z")); // 06:00 Tehran, Saturday
  assert.deepEqual(n, { dateIso: "2026-10-24", minutes: 360, dow: 0 });
  const m = S.tehranNow(new Date("2026-07-01T20:45:00Z")); // 00:15 next day, Thursday→Friday boundary check
  assert.equal(m.dateIso, "2026-07-02"); assert.equal(m.minutes, 15);
  const sum = S.tehranNow(new Date("2026-07-15T12:00:00Z")); // summer: still +3:30 (no DST)
  assert.equal(sum.minutes, 15 * 60 + 30);
});

test("isRunDay: weekday, range, skip dates", () => {
  const r = { weekdays: S.weekdaysExcept([5, 6]), times: ["06:00"], startDate: "2026-10-01", endDate: "2026-10-31", skipDates: ["2026-10-24"] };
  assert.equal(S.isRunDay(r, "2026-10-25"), true);   // Sunday
  assert.equal(S.isRunDay(r, "2026-10-24"), false);  // skipped (Saturday)
  assert.equal(S.isRunDay(r, "2026-10-22"), false);  // Thursday excluded
  assert.equal(S.isRunDay(r, "2026-10-23"), false);  // Friday excluded
  assert.equal(S.isRunDay(r, "2026-09-30"), false);  // before start
  assert.equal(S.isRunDay(r, "2026-11-01"), false);  // after end
});

test("dueSlots: on-time, catch-up window, too old, not yet", () => {
  const r = { weekdays: [0, 1, 2, 3, 4, 5, 6], times: ["06:00", "08:00", "21:00"] };
  const at = (h, m) => ({ dateIso: "2026-10-24", minutes: h * 60 + m, dow: 0 });
  assert.deepEqual(S.dueSlots(r, at(5, 59)), []);
  assert.deepEqual(S.dueSlots(r, at(6, 0)), ["06:00"]);
  assert.deepEqual(S.dueSlots(r, at(6, 44)), ["06:00"]);          // still inside the 45-min catch-up
  assert.deepEqual(S.dueSlots(r, at(6, 46)), []);                 // too old: skipped (never sent late)
  assert.deepEqual(S.dueSlots(r, at(8, 5)), ["08:00"]);           // 06:00 is far in the past
  assert.deepEqual(S.dueSlots(r, at(21, 30)), ["21:00"]);
  assert.deepEqual(S.dueSlots({ ...r, weekdays: [6] }, at(6, 0)), []); // today is Saturday, reminder is Friday-only
});

test("nextRuns skips past slots today and honours the weekday set", () => {
  const r = { weekdays: [6], times: ["09:00", "16:00"] }; // Fridays
  const runs = S.nextRuns(r, { dateIso: "2026-10-24", minutes: 600, dow: 0 }, 3); // Saturday 10:00
  assert.deepEqual(runs, [
    { date: "2026-10-30", time: "09:00" }, { date: "2026-10-30", time: "16:00" }, { date: "2026-11-06", time: "09:00" },
  ]);
  const today = S.nextRuns({ weekdays: [0], times: ["06:00", "21:00"] }, { dateIso: "2026-10-24", minutes: 600, dow: 0 }, 2);
  assert.deepEqual(today, [{ date: "2026-10-24", time: "21:00" }, { date: "2026-10-31", time: "06:00" }]);
});

test("describeSchedule + buildReminderMessage (HTML-escaped)", () => {
  const d = S.describeSchedule({ weekdays: S.weekdaysExcept([5, 6]), times: ["06:00", "08:00"] });
  assert.equal(d, "هر روز به‌جز پنجشنبه و جمعه — ساعت ۰۶:۰۰ و ۰۸:۰۰");
  const m = S.buildReminderMessage("امتحان <b>بده</b> & برو", "هفتم الف");
  assert.ok(m.includes("هفتم الف") && m.includes("&lt;b&gt;بده&lt;/b&gt; &amp; برو") && !m.includes("<b>بده"));
});
