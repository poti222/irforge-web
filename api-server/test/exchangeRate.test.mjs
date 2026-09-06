/**
 * test/exchangeRate.test.mjs
 *
 * Pure-function coverage for lib/exchangeRate.ts: `priceInRial()` (was
 * `priceInToman()` before IRFORGE_RIAL_MIGRATION Phase 2 dropped its
 * Rial→Toman `/10` step — the formula locked in with Ali in
 * identityverificationspec.md, now targeting Rial directly) and
 * `isRateStale()`. The DB-touching functions (`getCurrentExchangeRate`,
 * `refreshExchangeRateFromApi`, `setManualExchangeRate`) aren't covered
 * here, matching this repo's existing convention of no live-DB test
 * harness for routes/lib functions that require a real connection.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { priceInRial, isRateStale } = await import("../src/lib/exchangeRate.ts");

test("priceInRial: converts USD to Rial via rial-per-usd, rounded up to the nearest 100,000 Rial", () => {
  // 2.13 USD * 900,000 rial/usd = 1,917,000 rial → rounds up to 2,000,000.
  assert.equal(priceInRial(2.13, 900000), 2000000);
  // 3.5 USD * 900,000 = 3,150,000 rial → rounds up to 3,200,000.
  assert.equal(priceInRial(3.5, 900000), 3200000);
  // 5.13 USD * 900,000 = 4,617,000 rial → rounds up to 4,700,000.
  assert.equal(priceInRial(5.13, 900000), 4700000);
});

test("priceInRial: an amount that lands exactly on a 100,000 Rial boundary is not bumped up further", () => {
  // 1 USD * 100,000 rial/usd = 100,000 rial exactly.
  assert.equal(priceInRial(1, 100000), 100000);
});

test("priceInRial: zero USD price converts to zero Rial", () => {
  assert.equal(priceInRial(0, 900000), 0);
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

// ─── manual-override route wiring (source check, matching this repo's
// convention in test/adminPanel.test.mjs — no live-Express harness here) ───

test("POST /admin/exchange-rate rejects an implausible (Toman-scale) rialPerUsd before storing it", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const routeSrc = readFileSync(join(here, "../src/routes/exchangeRate.ts"), "utf8");
  assert.match(routeSrc, /isPlausibleRialPerUsd/, "must call the shared plausibility guard");
  assert.match(routeSrc, /implausible_scale/, "must return a distinguishable error code");
  // The guard must run BEFORE the value is ever persisted.
  const guardIdx = routeSrc.indexOf("isPlausibleRialPerUsd(rialPerUsd)");
  const persistIdx = routeSrc.indexOf("setManualExchangeRate(");
  assert.ok(guardIdx > -1 && persistIdx > -1 && guardIdx < persistIdx,
    "the plausibility check must run before setManualExchangeRate()");
});
