/**
 * test/currency.test.mjs — IRFORGE_RIAL_MIGRATION Phase 2.
 *
 * `lib/currency.ts`'s Toman<->Rial boundary helpers and the exchange-rate
 * plausibility guard shared between `routes/exchangeRate.ts` (manual
 * override validation) and `migrate.mjs` (pre-migration sanity check — that
 * file can't import this module directly since it runs as a standalone
 * script before any TypeScript build, so it keeps a literal, documented
 * copy of the same bounds; this is the one place those bounds are
 * exercised by an automated test).
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  tomanToRial,
  rialToToman,
  isPlausibleRialPerUsd,
  MIN_PLAUSIBLE_RIAL_PER_USD,
  MAX_PLAUSIBLE_RIAL_PER_USD,
} = await import("../src/lib/currency.ts");

test("tomanToRial: multiplies by 10", () => {
  assert.equal(tomanToRial(100_000), 1_000_000);
  assert.equal(tomanToRial(1), 10);
  assert.equal(tomanToRial(0), 0);
});

test("tomanToRial: rounds a fractional Toman input before scaling", () => {
  assert.equal(tomanToRial(100.6), 1010);
});

test("rialToToman: divides by 10, rounded", () => {
  assert.equal(rialToToman(1_000_000), 100_000);
  assert.equal(rialToToman(10), 1);
  assert.equal(rialToToman(0), 0);
});

test("rialToToman: rounds a non-round Rial figure rather than truncating", () => {
  assert.equal(rialToToman(1005), 101, "1005/10 = 100.5 → rounds up");
  assert.equal(rialToToman(1004), 100, "1004/10 = 100.4 → rounds down");
});

test("tomanToRial/rialToToman round-trip for any integer Toman amount", () => {
  for (const t of [0, 1, 42, 100_000, 999_999, 50_000_000]) {
    assert.equal(rialToToman(tomanToRial(t)), t);
  }
});

test("isPlausibleRialPerUsd: a real 2026-plausible rate passes", () => {
  assert.equal(isPlausibleRialPerUsd(900_000), true);
  assert.equal(isPlausibleRialPerUsd(1_500_000), true);
});

test("isPlausibleRialPerUsd: an obviously Toman-scale mistake (missing the ×10) fails", () => {
  assert.equal(isPlausibleRialPerUsd(90_000), false);
  assert.equal(isPlausibleRialPerUsd(45_000), false);
});

test("isPlausibleRialPerUsd: a value with stray extra zeros fails too", () => {
  assert.equal(isPlausibleRialPerUsd(900_000_000_000), false);
});

test("isPlausibleRialPerUsd: exactly at the bounds is plausible (inclusive)", () => {
  assert.equal(isPlausibleRialPerUsd(MIN_PLAUSIBLE_RIAL_PER_USD), true);
  assert.equal(isPlausibleRialPerUsd(MAX_PLAUSIBLE_RIAL_PER_USD), true);
});

test("isPlausibleRialPerUsd: just outside either bound fails", () => {
  assert.equal(isPlausibleRialPerUsd(MIN_PLAUSIBLE_RIAL_PER_USD - 1), false);
  assert.equal(isPlausibleRialPerUsd(MAX_PLAUSIBLE_RIAL_PER_USD + 1), false);
});

test("isPlausibleRialPerUsd: non-finite input is never plausible", () => {
  assert.equal(isPlausibleRialPerUsd(NaN), false);
  assert.equal(isPlausibleRialPerUsd(Infinity), false);
  assert.equal(isPlausibleRialPerUsd(-Infinity), false);
});
