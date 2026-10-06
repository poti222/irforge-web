/**
 * test/botLifetime.test.mjs — لایوباگ ۲۰۲۶-۱۰-۰۶: «بات‌ها وقتی زمانشان تمام می‌شود پاک نمی‌شوند؛ پرو و استاندارد
 * اصلاً زمان ندارند؛ تریال ۷ روز، استاندارد و پرو ۳۰ روز». منطقِ خالصِ lib/botLifetime.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const L = await import("../src/lib/botLifetime.ts");
const D = (s) => new Date(s);
const DAY = 86_400_000;

test("ثابت‌ها: تریال ۷ روز، پکیج ۳۰ روز، مهلتِ حذف ۷ روز، هشدارِ دوم ۳ روز مانده", () => {
  assert.equal(L.TRIAL_DAYS, 7);
  assert.equal(L.TIER_PERIOD_DAYS, 30);
  assert.equal(L.PURGE_RETENTION_DAYS, 7);
  assert.equal(L.PURGE_FINAL_WARNING_DAYS, 3);
});

test("addTierPeriod: دقیقاً ۳۰ روز (نه ماهِ تقویمی)؛ trialEndDate: ۷ روز", () => {
  assert.equal(L.addTierPeriod(D("2026-01-31T00:00:00Z")).toISOString(), "2026-03-02T00:00:00.000Z");
  assert.equal(L.addTierPeriod(D("2026-02-01T10:00:00Z")).toISOString(), "2026-03-03T10:00:00.000Z");
  assert.equal(L.trialEndDate(D("2026-10-06T12:00:00Z")).toISOString(), "2026-10-13T12:00:00.000Z");
  const before = Date.now();
  const t = L.trialEndDate().getTime();
  assert.ok(t - before >= 7 * DAY - 5 && t - before <= 7 * DAY + 1000);
});

test("botExpiry: تریالِ گذشته منقضی؛ تریالِ در جریان نه؛ پکیج فقط با tier_expired؛ سفارشی/بی‌پکیج هرگز", () => {
  const now = D("2026-10-10T00:00:00Z");
  const past = D("2026-10-01T00:00:00Z");
  const future = D("2026-10-20T00:00:00Z");
  assert.deepEqual(L.botExpiry({ isTrial: true, trialExpiresAt: past, status: "expired" }, now), { kind: "trial", expiredAt: past });
  assert.equal(L.botExpiry({ isTrial: true, trialExpiresAt: future, status: "active" }, now), null);
  // پکیجی که تاریخش گذشته ولی جاروی تمدید هنوز نرسیده (status هنوز active) ⇒ هرگز اشتباهی حذف نشود
  assert.equal(L.botExpiry({ tier: "standard", tierExpiresAt: past, status: "active" }, now), null);
  assert.deepEqual(L.botExpiry({ tier: "pro", tierExpiresAt: past, status: "tier_expired" }, now), { kind: "tier", expiredAt: past });
  assert.equal(L.botExpiry({ tier: "pro", tierExpiresAt: future, status: "tier_expired" }, now), null, "تمدید شده");
  assert.equal(L.botExpiry({ tier: "custom", tierExpiresAt: past, status: "tier_expired" }, now), null);
  assert.equal(L.botExpiry({ tier: null, status: "active" }, now), null);
  assert.equal(L.botExpiry({ tier: "standard", tierExpiresAt: null, status: "tier_expired" }, now), null);
});

test("computePurgeAfter: max(انقضا, الان) + ۷ روز — باتِ خیلی‌قدیمی هم ۷ روزِ کامل مهلت می‌گیرد", () => {
  const now = D("2026-10-10T00:00:00Z");
  assert.equal(L.computePurgeAfter(D("2026-10-09T23:00:00Z"), now).toISOString(), "2026-10-17T00:00:00.000Z");
  assert.equal(L.computePurgeAfter(D("2026-01-01T00:00:00Z"), now).toISOString(), "2026-10-17T00:00:00.000Z", "منقضی از ماه‌ها پیش ⇒ حذفِ ناگهانی نه");
  assert.equal(L.computePurgeAfter(D("2026-10-12T00:00:00Z"), now).toISOString(), "2026-10-19T00:00:00.000Z");
});

test("purgeStage: ۷ روز مانده → هشدار اول؛ ≤۳ روز → هشدار دوم؛ رسیده → حذف", () => {
  const at = D("2026-10-17T00:00:00Z");
  assert.equal(L.purgeStage(at, D("2026-10-10T00:00:00Z")), "first_warning");
  assert.equal(L.purgeStage(at, D("2026-10-13T23:00:00Z")), "first_warning", "کمی بیش از ۳ روز مانده");
  assert.equal(L.purgeStage(at, D("2026-10-14T00:00:00Z")), "final_warning", "دقیقاً ۳ روز مانده");
  assert.equal(L.purgeStage(at, D("2026-10-16T12:00:00Z")), "final_warning");
  assert.equal(L.purgeStage(at, D("2026-10-17T00:00:00Z")), "delete");
  assert.equal(L.purgeStage(at, D("2026-10-30T00:00:00Z")), "delete");
  assert.equal(L.purgeDaysLeft(at, D("2026-10-16T12:00:00Z")), 1);
  assert.equal(L.purgeDaysLeft(at, D("2026-10-30T00:00:00Z")), 0);
});
