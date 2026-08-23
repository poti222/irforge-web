/**
 * test/tehran-time.test.mjs — IRFORGE_PROMPT_V3 Phase 19
 *
 * Covers the Jalali (Solar Hijri) additions to src/lib/tehran-time.ts — a
 * direct port of the same public-domain day-count algorithm already used
 * and tested in `plugins/_common/jalali.py` (bot side) and cross-checked
 * against `bot/tests/test_jalali.py`'s own facts (the well-known Nowruz
 * 1358 date, the fixed month-length structure, and round-tripping).
 *
 * Run with: pnpm --filter @workspace/irforge run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const {
  gregorianToJalali, jalaliToGregorian, toPersianDigits, fromPersianDigits,
  formatJalali, weekdayNameFa, jalaliDatetimeToUtc, utcToJalaliDatetime,
} = await import("../src/lib/tehran-time.ts");

test("well-known Nowruz 1358", () => {
  assert.deepEqual(gregorianToJalali(1979, 3, 21), [1358, 1, 1]);
});

test("round-trip gregorian -> jalali -> gregorian, weekly over ten years", () => {
  const start = Date.UTC(2015, 0, 1);
  for (let offset = 0; offset < 365 * 10; offset += 7) {
    const d = new Date(start + offset * 86_400_000);
    const [jy, jm, jd] = gregorianToJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    const back = jalaliToGregorian(jy, jm, jd);
    assert.deepEqual(back, [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()], d.toISOString());
  }
});

test("round-trip jalali -> gregorian -> jalali across all months", () => {
  for (const jy of [1358, 1390, 1400, 1403, 1404, 1405]) {
    for (let jm = 1; jm <= 12; jm++) {
      const jd = 15;
      const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
      assert.deepEqual(gregorianToJalali(gy, gm, gd), [jy, jm, jd], `${jy}-${jm}-${jd}`);
    }
  }
});

test("jalali year never decreases as the gregorian date increases", () => {
  let prevY = gregorianToJalali(2000, 1, 1)[0];
  for (let year = 2001; year < 2030; year++) {
    const curY = gregorianToJalali(year, 1, 1)[0];
    assert.ok(curY >= prevY);
    prevY = curY;
  }
});

test("jalali months have the documented lengths", () => {
  for (let jm = 1; jm <= 6; jm++) {
    const [gy, gm, gd] = jalaliToGregorian(1403, jm, 31);
    assert.deepEqual(gregorianToJalali(gy, gm, gd), [1403, jm, 31]);
  }
  for (let jm = 7; jm <= 11; jm++) {
    const [gy, gm, gd] = jalaliToGregorian(1403, jm, 30);
    assert.deepEqual(gregorianToJalali(gy, gm, gd), [1403, jm, 30]);
  }
});

test("formatJalali uses persian digits by default", () => {
  assert.equal(formatJalali(1979, 3, 21), "۱۳۵۸/۰۱/۰۱");
});

test("formatJalali can stay ascii", () => {
  assert.equal(formatJalali(1979, 3, 21, false), "1358/01/01");
});

test("toPersianDigits leaves non-digits untouched", () => {
  assert.equal(toPersianDigits("2026-08-23"), "۲۰۲۶-۰۸-۲۳");
  assert.equal(toPersianDigits("abc"), "abc");
});

test("fromPersianDigits round-trips with toPersianDigits", () => {
  const original = "1405/06/01";
  assert.equal(fromPersianDigits(toPersianDigits(original)), original);
});

test("fromPersianDigits leaves ascii untouched", () => {
  assert.equal(fromPersianDigits("18:30"), "18:30");
});

test("weekdayNameFa covers all seven bot days", () => {
  const names = new Set([0, 1, 2, 3, 4, 5, 6].map(weekdayNameFa));
  assert.equal(names.size, 7);
  assert.equal(weekdayNameFa(0), "دوشنبه");
  assert.equal(weekdayNameFa(6), "یکشنبه");
});

// ── jalaliDatetimeToUtc / utcToJalaliDatetime ───────────────────────────────

test("jalaliDatetimeToUtc converts Tehran local time to UTC", () => {
  // Tehran is UTC+03:30 — 18:00 Tehran time is 14:30 UTC.
  const iso = jalaliDatetimeToUtc(1405, 5, 1, 18, 0);
  const dt = new Date(iso);
  assert.equal(dt.getUTCHours(), 14);
  assert.equal(dt.getUTCMinutes(), 30);
});

test("utcToJalaliDatetime is the inverse of jalaliDatetimeToUtc", () => {
  const iso = jalaliDatetimeToUtc(1405, 5, 1, 18, 0);
  const { jy, jm, jd, hour, minute } = utcToJalaliDatetime(iso);
  assert.deepEqual([jy, jm, jd, hour, minute], [1405, 5, 1, 18, 0]);
});

test("jalali datetime round-trips across many dates and hours", () => {
  for (const jy of [1400, 1403, 1404, 1405]) {
    for (const jm of [1, 6, 12]) {
      for (const hour of [0, 9, 18, 23]) {
        const iso = jalaliDatetimeToUtc(jy, jm, 10, hour, 45);
        const back = utcToJalaliDatetime(iso);
        assert.deepEqual(
          [back.jy, back.jm, back.jd, back.hour, back.minute],
          [jy, jm, 10, hour, 45],
          `${jy}-${jm}-10 ${hour}:45`
        );
      }
    }
  }
});
