/**
 * test/order-amount.test.mjs — IRFORGE_PROMPT_V3 Phase 51
 *
 * Covers src/lib/order-amount.ts: an order's amount is `unknown` (whatever
 * the bot's own sheet holds), so formatting it has to stay safe for values
 * that aren't clean numbers, and label it with the bot's own currency.
 *
 * Run with: pnpm --filter @workspace/irforge run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { formatOrderAmount } = await import("../src/lib/order-amount.ts");

test("formatOrderAmount groups a numeric amount and appends the currency (en)", () => {
  assert.equal(formatOrderAmount(150000, "Toman", "en"), "150,000 Toman");
});

test("formatOrderAmount groups a numeric amount and appends the currency (fa)", () => {
  assert.equal(formatOrderAmount(150000, "تومان", "fa"), "۱۵۰٬۰۰۰ تومان");
});

test("formatOrderAmount accepts a numeric string", () => {
  assert.equal(formatOrderAmount("150000", "USD", "en"), "150,000 USD");
});

test("formatOrderAmount falls back to the raw value when it isn't numeric", () => {
  assert.equal(formatOrderAmount("cash on delivery", "Toman", "en"), "cash on delivery Toman");
});

test("formatOrderAmount renders an em dash for null, undefined, or empty", () => {
  assert.equal(formatOrderAmount(null, "Toman", "en"), "—");
  assert.equal(formatOrderAmount(undefined, "Toman", "en"), "—");
  assert.equal(formatOrderAmount("", "Toman", "en"), "—");
  assert.equal(formatOrderAmount("   ", "Toman", "en"), "—");
});

test("formatOrderAmount omits the currency suffix when none is configured", () => {
  assert.equal(formatOrderAmount(1000, "", "en"), "1,000");
});

test("formatOrderAmount treats 0 as a real amount, not a missing one", () => {
  assert.equal(formatOrderAmount(0, "Toman", "en"), "0 Toman");
});
