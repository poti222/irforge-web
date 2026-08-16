/**
 * test/tehranClock.test.mjs — ساعت تهران در **فرانت**.
 *
 * چرا این تست در api-server است: پکیج `irforge` هیچ test runnerی ندارد و
 * افزودن یکی کاری خارج از این دور است — همان دلیلی که `panelButtons.test.mjs`
 * هم اینجاست. ماژول فرانت مستقیم از روی سورس import می‌شود.
 *
 * `TZ` عمداً روی جایی غیر از تهران ست می‌شود: باگ اصلی این بود که حساب دستیِ
 * آفست فقط وقتی درست بود که مرورگر خودش روی تهران باشد. اگر کسی روزی به آن
 * روش برگردد، این تست می‌افتد.
 */
process.env.TZ = "America/New_York";
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";

const { tehranNow, jsDayToBotDay } = await import("../../irforge/src/lib/tehran-time.ts");

test("ساعت تهران از منطقه‌ی زمانی مرورگر مستقل است", () => {
  // ۲۰۲۶-۰۳-۱۰ ساعت ۲۱:۰۰ UTC = ۰۰:۳۰ روز بعد به وقت تهران.
  // با روش قدیمی (getTimezoneOffset) روی نیویورک نتیجه ۵ ساعت غلط می‌شد.
  const at = tehranNow(new Date("2026-03-10T21:00:00Z"));
  assert.equal(at.label, "00:30");
  assert.equal(at.minutes, 30);
});

test("نیمه‌شب «00:00» است، نه «24:00»", () => {
  // ۲۰:۳۰ UTC = ۰۰:۰۰ تهران. بعضی محیط‌ها با hour12:false عدد ۲۴ می‌دهند،
  // که هم برچسب را خراب می‌کند و هم `minutes` را ۱۴۴۰ می‌کند.
  const at = tehranNow(new Date("2026-03-10T20:30:00Z"));
  assert.equal(at.label, "00:00");
  assert.equal(at.minutes, 0);
});

test("ظهر و بعدازظهر درست حساب می‌شوند", () => {
  // ۰۹:۰۰ UTC = ۱۲:۳۰ تهران.
  const noon = tehranNow(new Date("2026-06-15T09:00:00Z"));
  assert.equal(noon.label, "12:30");
  assert.equal(noon.minutes, 12 * 60 + 30);
});

test("روزِ هفته به قرارداد بات (۰=دوشنبه) تبدیل می‌شود", () => {
  assert.equal(jsDayToBotDay(1), 0, "دوشنبه");
  assert.equal(jsDayToBotDay(0), 6, "یکشنبه آخرِ هفته است، نه اولش");
  assert.equal(jsDayToBotDay(6), 5, "شنبه");
});

test("روز درست انتخاب می‌شود حتی وقتی تهران از UTC جلوتر رفته", () => {
  // ۲۰۲۶-۰۳-۱۰ سه‌شنبه است. ۲۱:۰۰ UTC در تهران چهارشنبه‌ی ۱۱ است.
  const at = tehranNow(new Date("2026-03-10T21:00:00Z"));
  assert.equal(at.day, jsDayToBotDay(3), "باید چهارشنبه باشد، نه سه‌شنبه");
});
