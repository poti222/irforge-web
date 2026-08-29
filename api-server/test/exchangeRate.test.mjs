/**
 * test/exchangeRate.test.mjs
 *
 * Pure-function coverage for lib/exchangeRate.ts: `priceInToman()` (the
 * formula locked in with Ali in identityverificationspec.md) and
 * `isRateStale()`. The DB-touching functions (`getCurrentExchangeRate`,
 * `refreshExchangeRateFromApi`, `setManualExchangeRate`) aren't covered
 * here, matching this repo's existing convention of no live-DB test
 * harness for routes/lib functions that require a real connection.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";

const { priceInToman, isRateStale } = await import("../src/lib/exchangeRate.ts");

test("priceInToman: converts USD to Toman via rial-per-usd, rounded up to the nearest 10,000 Toman", () => {
  // 2.13 USD * 900,000 rial/usd = 1,917,000 rial = 191,700 Toman → rounds up to 200,000.
  assert.equal(priceInToman(2.13, 900000), 200000);
  // 3.5 USD * 900,000 = 3,150,000 rial = 315,000 Toman → already a multiple of 10,000.
  assert.equal(priceInToman(3.5, 900000), 320000);
  // 5.13 USD * 900,000 = 4,617,000 rial = 461,700 Toman → rounds up to 470,000.
  assert.equal(priceInToman(5.13, 900000), 470000);
});

test("priceInToman: an amount that lands exactly on a 10,000 Toman boundary is not bumped up further", () => {
  // 1 USD * 100,000 rial/usd = 100,000 rial = 10,000 Toman exactly.
  assert.equal(priceInToman(1, 100000), 10000);
});

test("priceInToman: zero USD price converts to zero Toman", () => {
  assert.equal(priceInToman(0, 900000), 0);
});

test("isRateStale: a rate fetched within the staleness window is not stale", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const fetchedAt = new Date("2026-01-01T10:00:00Z"); // 2 hours old
  assert.equal(isRateStale(fetchedAt, now), false);
});

test("isRateStale: a rate older than the staleness window is stale", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const fetchedAt = new Date("2026-01-01T08:00:00Z"); // 4 hours old
  assert.equal(isRateStale(fetchedAt, now), true);
});

test("isRateStale: exactly at the staleness boundary is not yet stale (strict greater-than)", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const fetchedAt = new Date("2026-01-01T09:00:00Z"); // exactly 3 hours old
  assert.equal(isRateStale(fetchedAt, now), false);
});
