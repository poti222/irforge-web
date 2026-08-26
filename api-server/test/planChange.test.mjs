/**
 * test/planChange.test.mjs — IRFORGE_PROMPT_V3 Phase 34.
 *
 * `decidePlanChange` is pure (no db, no wallet), so this needs no mocking at
 * all — every case below is a plain input → output check.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decidePlanChange, addInterval } from "../src/lib/planChange.ts";

const NOW = new Date("2026-08-25T00:00:00.000Z");

function plan(overrides = {}) {
  return { id: "gold", price: 199_000, interval: "monthly", ...overrides };
}

function existing(overrides = {}) {
  return {
    planId: "silver",
    status: "active",
    expiresAt: new Date("2026-09-25T00:00:00.000Z"),
    renewsAt: new Date("2026-09-25T00:00:00.000Z"),
    ...overrides,
  };
}

test("بدون اشتراکِ قبلی → subscribe، کسرِ کاملِ قیمت، دوره از الان", () => {
  const d = decidePlanChange(plan(), null, 0, NOW);
  assert.equal(d.action, "subscribe");
  assert.equal(d.charge, 199_000);
  assert.deepEqual(d.nextExpiresAt, addInterval(NOW, "monthly"));
  assert.deepEqual(d.nextRenewsAt, d.nextExpiresAt);
});

test("پلنِ فعلی ارزان‌تر و فعال → upgrade، کسرِ کاملِ قیمتِ پلنِ جدید", () => {
  const d = decidePlanChange(plan({ price: 199_000 }), existing(), 99_000, NOW);
  assert.equal(d.action, "upgrade");
  assert.equal(d.charge, 199_000);
  assert.deepEqual(d.nextExpiresAt, addInterval(NOW, "monthly"));
});

test("پلنِ فعلی گران‌تر و فعال → downgrade، بدون کسر، انقضای فعلی دست‌نخورده", () => {
  const cur = existing({ planId: "gold", expiresAt: new Date("2026-09-10T00:00:00.000Z") });
  const d = decidePlanChange(plan({ id: "silver", price: 99_000 }), cur, 199_000, NOW);
  assert.equal(d.action, "downgrade");
  assert.equal(d.charge, 0);
  assert.deepEqual(d.nextExpiresAt, cur.expiresAt);
  assert.deepEqual(d.nextRenewsAt, cur.renewsAt);
});

test("هم‌قیمت → downgrade حساب می‌شود (بدون کسرِ دوباره)", () => {
  const cur = existing({ planId: "gold-old" });
  const d = decidePlanChange(plan({ id: "gold-new", price: 199_000 }), cur, 199_000, NOW);
  assert.equal(d.action, "downgrade");
  assert.equal(d.charge, 0);
});

test("همان پلنِ فعلی، هنوز منقضی نشده → renew، کسر می‌شود و از تاریخِ انقضای فعلی جلو می‌رود", () => {
  const cur = existing({ planId: "gold", expiresAt: new Date("2026-09-25T00:00:00.000Z") });
  const d = decidePlanChange(plan({ id: "gold", price: 199_000 }), cur, 199_000, NOW);
  assert.equal(d.action, "renew");
  assert.equal(d.charge, 199_000);
  assert.deepEqual(d.nextExpiresAt, addInterval(cur.expiresAt, "monthly"));
});

test("همان پلنِ فعلی ولی منقضی‌شده → renew، از الان جلو می‌رود نه از تاریخِ گذشته", () => {
  const cur = existing({ planId: "gold", expiresAt: new Date("2026-08-01T00:00:00.000Z") });
  const d = decidePlanChange(plan({ id: "gold", price: 199_000 }), cur, 0, NOW);
  assert.equal(d.action, "renew");
  assert.deepEqual(d.nextExpiresAt, addInterval(NOW, "monthly"));
});

test("پلنِ رایگان → downgrade، بدون کسر، بدون تاریخ انقضا", () => {
  const d = decidePlanChange(plan({ id: "free", price: 0, interval: "monthly" }), existing(), 199_000, NOW);
  assert.equal(d.action, "downgrade");
  assert.equal(d.charge, 0);
  assert.equal(d.nextExpiresAt, null);
  assert.equal(d.nextRenewsAt, null);
});

test("اشتراکِ قبلی منقضی‌شده (نه رایگان) → مثلِ subscribe رفتار می‌کند، نه upgrade/downgrade", () => {
  const cur = existing({ planId: "silver", expiresAt: new Date("2026-08-01T00:00:00.000Z") });
  const d = decidePlanChange(plan({ id: "gold", price: 199_000 }), cur, 99_000, NOW);
  assert.equal(d.action, "subscribe");
  assert.equal(d.charge, 199_000);
  assert.deepEqual(d.nextExpiresAt, addInterval(NOW, "monthly"));
});

test("اشتراکِ قبلیِ status=canceled (فعال نیست) → subscribe، نه downgrade، حتی اگر پلنِ جدید ارزان‌تر باشد", () => {
  const cur = existing({ planId: "silver", status: "canceled" });
  const d = decidePlanChange(plan({ id: "gold", price: 199_000 }), cur, 99_000, NOW);
  assert.equal(d.action, "subscribe");
  assert.equal(d.charge, 199_000);
});

test("interval=yearly → دوره ۱۲ ماه جلو می‌رود", () => {
  const d = decidePlanChange(plan({ interval: "yearly", price: 1_500_000 }), null, 0, NOW);
  const expected = new Date(NOW);
  expected.setMonth(expected.getMonth() + 12);
  assert.deepEqual(d.nextExpiresAt, expected);
});

test("expiresAt=null (بدون انقضا) روی پلنِ فعلی فعال حساب می‌شود", () => {
  const cur = existing({ planId: "gold", expiresAt: null, renewsAt: null });
  // همان پلن، بدون انقضا → renew از الان (چون هیچ تاریخِ آینده‌ای برای جلو رفتن نیست)
  const d = decidePlanChange(plan({ id: "gold", price: 199_000 }), cur, 199_000, NOW);
  assert.equal(d.action, "renew");
  assert.deepEqual(d.nextExpiresAt, addInterval(NOW, "monthly"));
});

test("addInterval: ماهانه ۱ ماه جلو، سالانه ۱۲ ماه جلو", () => {
  const base = new Date("2026-03-10T00:00:00.000Z");
  const monthly = addInterval(base, "monthly");
  assert.equal(monthly.getUTCFullYear(), 2026);
  assert.equal(monthly.getUTCMonth(), 3); // April
  assert.equal(monthly.getUTCDate(), 10);

  const yearly = addInterval(base, "yearly");
  assert.equal(yearly.getUTCFullYear(), 2027);
  assert.equal(yearly.getUTCMonth(), 2); // still March
});
