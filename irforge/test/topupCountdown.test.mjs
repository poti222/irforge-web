/**
 * test/topupCountdown.test.mjs — شمارشگرِ ۵دقیقه‌ایِ بعد از فیش (چک‌لیستِ نهایی: «مسیر فیش + تأیید دستی + شمارنده ۵ دقیقه»).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { receiptReviewPhase, RECEIPT_COUNTDOWN_SECONDS } = await import("../src/lib/topupCountdown.ts");
const T0 = new Date("2026-09-29T12:00:00Z");
const at = (sec) => T0.getTime() + sec * 1000;

test("پنجره‌ی خودکار دقیقاً ۵ دقیقه است", () => assert.equal(RECEIPT_COUNTDOWN_SECONDS, 300));

test("لحظه‌ی آپلود: ۳۰۰ ثانیه مانده؛ وسطِ راه: کم می‌شود؛ ثانیه‌ی آخر: ۱", () => {
  assert.deepEqual(receiptReviewPhase(T0.toISOString(), at(0)), { phase: "auto", secondsLeft: 300 });
  assert.deepEqual(receiptReviewPhase(T0.toISOString(), at(120)), { phase: "auto", secondsLeft: 180 });
  assert.deepEqual(receiptReviewPhase(T0.toISOString(), at(299)), { phase: "auto", secondsLeft: 1 });
  assert.deepEqual(receiptReviewPhase(T0.toISOString(), at(299.4)), { phase: "auto", secondsLeft: 1 });
});

test("بعد از ۵ دقیقه (و بعد از آن) → بررسیِ دستی", () => {
  assert.deepEqual(receiptReviewPhase(T0.toISOString(), at(300)), { phase: "manual" });
  assert.deepEqual(receiptReviewPhase(T0.toISOString(), at(3600)), { phase: "manual" });
});

test("ساعتِ کلاینت عقب‌تر از سرور باشد هم بیش از ۳۰۰ ثانیه نشان نمی‌دهد", () => {
  assert.deepEqual(receiptReviewPhase(T0.toISOString(), at(-90)), { phase: "auto", secondsLeft: 300 });
});

test("تاریخِ خالی/نامعتبر → بررسیِ دستی (هیچ وعده‌ی خودکاری نمی‌دهد)", () => {
  for (const bad of [null, undefined, "", "not-a-date"]) assert.deepEqual(receiptReviewPhase(bad, at(0)), { phase: "manual" });
});
