/**
 * test/currency-format.test.mjs — IRFORGE_PROMPT_V3 Phase 39
 *
 * Covers src/lib/format.ts's additive currency-conversion helpers
 * (convertFromToman, formatConvertedAmount). Toman pricing itself
 * (formatToman) predates this test file and stays untouched; these two
 * functions are new display-only math added for the multi-currency feature.
 *
 * Run with: pnpm --filter @workspace/irforge run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { convertFromToman, formatConvertedAmount } = await import("../src/lib/format.ts");

const USD = { code: "USD", label: "US Dollar", tomanPerUnit: 60000 };

// ── convertFromToman ─────────────────────────────────────────────────────

test("convertFromToman divides by the rate's tomanPerUnit", () => {
  assert.equal(convertFromToman(1_200_000, USD), 20);
});

test("convertFromToman returns 0 for a non-finite amount", () => {
  assert.equal(convertFromToman(NaN, USD), 0);
  assert.equal(convertFromToman(Infinity, USD), 0);
});

test("convertFromToman returns 0 when tomanPerUnit is 0 (guards a division by zero)", () => {
  assert.equal(convertFromToman(100_000, { ...USD, tomanPerUnit: 0 }), 0);
});

// ── formatConvertedAmount ────────────────────────────────────────────────

test("formatConvertedAmount returns null when no rate is active", () => {
  assert.equal(formatConvertedAmount(1_200_000, null, "en"), null);
  assert.equal(formatConvertedAmount(1_200_000, undefined, "en"), null);
});

test("formatConvertedAmount shows an approx-prefixed amount with the rate's code, en digits", () => {
  assert.equal(formatConvertedAmount(1_200_000, USD, "en"), "≈ 20.00 USD");
});

test("formatConvertedAmount uses Persian digits for fa", () => {
  const out = formatConvertedAmount(1_200_000, USD, "fa");
  assert.match(out, /^≈ /);
  assert.match(out, /USD$/);
  // fa-IR toLocaleString renders Persian digits, e.g. ۲۰٫۰۰ rather than 20.00
  assert.equal(/20\.00/.test(out), false);
});

test("formatConvertedAmount treats a null/undefined/non-numeric amount as 0", () => {
  assert.equal(formatConvertedAmount(null, USD, "en"), "≈ 0.00 USD");
  assert.equal(formatConvertedAmount(undefined, USD, "en"), "≈ 0.00 USD");
  assert.equal(formatConvertedAmount("not-a-number", USD, "en"), "≈ 0.00 USD");
});

test("formatConvertedAmount accepts a numeric string amount", () => {
  assert.equal(formatConvertedAmount("600000", USD, "en"), "≈ 10.00 USD");
});
