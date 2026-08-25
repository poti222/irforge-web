/**
 * test/digits.test.mjs — IRFORGE_PROMPT_V3 Phase 40
 *
 * Covers src/lib/digits.ts: folding Persian/Arabic-Indic digits to ASCII so a
 * text-based amount input actually accepts what a Persian/Arabic keyboard
 * types, and the thousands-grouping shown back to the visitor while typing.
 *
 * Run with: pnpm --filter @workspace/irforge run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { foldDigits, digitsOnly, groupAmount } = await import("../src/lib/digits.ts");

// ── foldDigits ───────────────────────────────────────────────────────────

test("foldDigits converts Persian digits to ASCII", () => {
  assert.equal(foldDigits("۱۲۳۴۵۶۷۸۹۰"), "1234567890");
});

test("foldDigits converts Arabic-Indic digits to ASCII", () => {
  assert.equal(foldDigits("٠١٢٣٤٥٦٧٨٩"), "0123456789");
});

test("foldDigits leaves ASCII digits and other characters untouched", () => {
  assert.equal(foldDigits("Toman: 120,000!"), "Toman: 120,000!");
});

test("foldDigits handles a mix of scripts in one string", () => {
  assert.equal(foldDigits("۱۲0١٢"), "12012");
});

// ── digitsOnly ───────────────────────────────────────────────────────────

test("digitsOnly folds then strips every non-ASCII-digit character", () => {
  assert.equal(digitsOnly("۱۲۰,۰۰۰ تومان"), "120000");
});

test("digitsOnly strips pasted thousands separators from an already-grouped value", () => {
  assert.equal(digitsOnly("1,200,000"), "1200000");
});

test("digitsOnly returns an empty string when there are no digits at all", () => {
  assert.equal(digitsOnly("تومان"), "");
});

// ── groupAmount ──────────────────────────────────────────────────────────

test("groupAmount adds thousands separators for en", () => {
  assert.equal(groupAmount("1200000", "en"), "1,200,000");
});

test("groupAmount uses Persian digits and separator for fa", () => {
  const out = groupAmount("1200000", "fa");
  assert.equal(/[0-9]/.test(out), false);
  assert.equal(out.replace(/[^۰-۹]/g, ""), "۱۲۰۰۰۰۰");
});

test("groupAmount accepts a raw number directly", () => {
  assert.equal(groupAmount(50000, "en"), "50,000");
});

test("groupAmount trims a leading run of zeros the way a person types them", () => {
  assert.equal(groupAmount("0120000", "en"), "120,000");
});

test("groupAmount returns an empty string for an empty/non-numeric input", () => {
  assert.equal(groupAmount("", "en"), "");
  assert.equal(groupAmount("abc", "en"), "");
});

test("groupAmount folds Persian digits before grouping", () => {
  assert.equal(groupAmount("۱۲۰۰۰۰۰", "en"), "1,200,000");
});
