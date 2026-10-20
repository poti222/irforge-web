/**
 * test/schoolRepSchedule.test.mjs — منطقِ خالصِ «دانش‌آموزِ منتخب» (lib/schoolRepSchedule.ts): تبدیلِ جلالی، پارسِ تاریخ،
 * محاسبهٔ یادآوری و متنِ پیام. بدونِ DB/شبکه؛ با `npm test` (node --test) اجرا می‌شود.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const S = await import("../src/lib/schoolRepSchedule.ts");

test("جلالی ↔ میلادی: نقاطِ مرجع", () => {
  assert.equal(S.jalaliToIso(1405, 1, 1), "2026-03-21");
  assert.equal(S.jalaliToIso(1404, 1, 1), "2025-03-21");
  assert.equal(S.jalaliToIso(1405, 7, 18), "2026-10-10");
  assert.deepEqual(S.isoToJalali("2026-10-10"), { jy: 1405, jm: 7, jd: 18 });
  assert.equal(S.jalaliString("2026-10-10"), "۱۴۰۵/۰۷/۱۸");
});

test("جلالی: تاریخِ نامعتبر رد می‌شود (۳۱ اسفندِ سالِ غیرکبیسه، ماه ۱۳، روز ۳۲)", () => {
  assert.equal(S.jalaliToIso(1405, 12, 30), null); // ۱۴۰۵ کبیسه نیست
  assert.notEqual(S.jalaliToIso(1403, 12, 30), null); // ۱۴۰۳ کبیسه است
  assert.equal(S.jalaliToIso(1405, 13, 1), null);
  assert.equal(S.jalaliToIso(1405, 1, 32), null);
  assert.equal(S.jalaliToIso(1405, 7, 31), null); // مهر ۳۰ روز است
});

test("جلالی: تطبیق با فهرستِ مرجعِ jdatetime (در صورتِ وجودِ فایل)", () => {
  const p = process.env.JCASES ?? "/tmp/jcases.json";
  if (!existsSync(p)) return;
  const cases = JSON.parse(readFileSync(p, "utf8"));
  for (const [g, jy, jm, jd] of cases) {
    assert.equal(S.jalaliToIso(jy, jm, jd), g, `j→g ${jy}/${jm}/${jd}`);
    assert.deepEqual(S.isoToJalali(g), { jy, jm, jd }, `g→j ${g}`);
  }
});

test("روزِ هفته و فاصله", () => {
  assert.equal(S.weekdayFa("2026-10-10"), "شنبه"); // ۱۸ مهر ۱۴۰۵ شنبه است
  assert.equal(S.weekdayFa("2026-10-11"), "یکشنبه");
  assert.equal(S.dowOf("2026-10-10"), 0);
  assert.equal(S.dowOf("2026-10-16"), 6); // جمعه
  assert.equal(S.daysBetween("2026-10-10", "2026-10-13"), 3);
  assert.equal(S.daysBetween("2026-10-10", "2026-10-09"), -1);
  assert.equal(S.addDays("2026-12-30", 3), "2027-01-02");
});

test("parseUserDate: نسبی، جلالی، میلادی، ارقامِ فارسی", () => {
  const T = "2026-10-10";
  assert.deepEqual(S.parseUserDate("امروز", T), { ok: true, iso: "2026-10-10" });
  assert.deepEqual(S.parseUserDate("فردا", T), { ok: true, iso: "2026-10-11" });
  assert.deepEqual(S.parseUserDate("پس‌فردا", T), { ok: true, iso: "2026-10-12" });
  assert.deepEqual(S.parseUserDate("پس فردا", T), { ok: true, iso: "2026-10-12" });
  assert.deepEqual(S.parseUserDate("۳ روز دیگر", T), { ok: true, iso: "2026-10-13" });
  assert.deepEqual(S.parseUserDate("2 هفته دیگر", T), { ok: true, iso: "2026-10-24" });
  assert.deepEqual(S.parseUserDate("۱۴۰۵/۰۷/۲۵", T), { ok: true, iso: "2026-10-17" });
  assert.deepEqual(S.parseUserDate("1405-7-25", T), { ok: true, iso: "2026-10-17" });
  assert.deepEqual(S.parseUserDate("2026-10-20", T), { ok: true, iso: "2026-10-20" });
});

test("parseUserDate: گذشته/دور/نامعتبر", () => {
  const T = "2026-10-10";
  assert.deepEqual(S.parseUserDate("1405/07/17", T), { ok: false, reason: "past" });
  assert.deepEqual(S.parseUserDate("2030-01-01", T), { ok: false, reason: "far" });
  assert.deepEqual(S.parseUserDate("1405/13/01", T), { ok: false, reason: "invalid" });
  assert.deepEqual(S.parseUserDate("2026-02-30", T), { ok: false, reason: "invalid" });
  assert.deepEqual(S.parseUserDate("سلام", T), { ok: false, reason: "invalid" });
  assert.deepEqual(S.parseUserDate("", T), { ok: false, reason: "invalid" });
});

test("normalizeRemindDays: فقط مقدارهایِ مجاز، یکتا، نزولی", () => {
  assert.deepEqual(S.normalizeRemindDays([1, 3, 3, 99, "2", -1, "x"]), [3, 2, 1]);
  assert.deepEqual(S.normalizeRemindDays(null), []);
  assert.deepEqual(S.normalizeRemindDays([0, 7]), [7, 0]);
});

test("reminderDueToday: فقط وقتی فاصله دقیقاً یکی از روزهایِ انتخابی است", () => {
  assert.equal(S.reminderDueToday("2026-10-10", "2026-10-13", [3, 1]), 3);
  assert.equal(S.reminderDueToday("2026-10-12", "2026-10-13", [3, 1]), 1);
  assert.equal(S.reminderDueToday("2026-10-11", "2026-10-13", [3, 1]), null);
  assert.equal(S.reminderDueToday("2026-10-13", "2026-10-13", [3, 1]), null);
  assert.equal(S.reminderDueToday("2026-10-13", "2026-10-13", [0]), 0);
  assert.equal(S.reminderDueToday("2026-10-14", "2026-10-13", [3, 1, 0]), null); // گذشته
});

test("whenFa و buildReminderText: فارسی، HTML-escape", () => {
  assert.equal(S.whenFa(0), "امروز");
  assert.equal(S.whenFa(1), "فردا");
  assert.equal(S.whenFa(2), "پس‌فردا");
  assert.equal(S.whenFa(5), "۵ روز دیگر");
  const t = S.buildReminderText({ kind: "exam", title: "ریاضی <فصل ۳> & هندسه", dueDate: "2026-10-13", diff: 3, className: "هفتم‌الف", repName: "علی" });
  assert.match(t, /یادآوریِ امتحان/);
  assert.match(t, /ریاضی &lt;فصل ۳&gt; &amp; هندسه/);
  assert.match(t, /۱۴۰۵\/۰۷\/۲۱/);
  assert.match(t, /۳ روز دیگر/);
  const today = S.buildReminderText({ kind: "assignment", title: "x", dueDate: "2026-10-10", diff: 0, className: "c", repName: "r" });
  assert.match(today, /امروز!/);
});

test("tehranHour: ۰–۲۳", () => {
  const h = S.tehranHour(new Date("2026-10-10T12:00:00Z")); // 15:30 تهران
  assert.ok(h === 15 || h === 16);
  assert.ok(S.tehranHour(new Date("2026-10-10T21:00:00Z")) < 24);
});
