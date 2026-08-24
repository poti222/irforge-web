/**
 * test/botPluginData.test.mjs — IRFORGE_PROMPT_V3 Phase 23
 *
 * Covers routes/botPluginData.ts's subscriptionExtendSideEffect: extending a
 * member's subscription (moving current_period_end) from the generic
 * plugin-collection editor used to leave expiry_notified_at/renewal_failures
 * untouched — the exact fields plugins/subscription/domain.py::extend resets
 * on a bot-side extension, so a customer whose subscription was extended
 * from the website never got a fresh "N days left" warning before their
 * new period lapsed.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const { __testables } = await import("../src/routes/botPluginData.ts");
const { subscriptionExtendSideEffect } = __testables;

const SPEC = { key: "member-subscriptions" };
const OTHER_SPEC = { key: "some-other-collection" };

test("current_period_end واقعاً تغییر کرده → expiry_notified_at و renewal_failures صفر می‌شوند", () => {
  const existing = { current_period_end: "2026-08-01T00:00:00.000Z", expiry_notified_at: "2026-07-25T00:00:00.000Z", renewal_failures: 2 };
  const payload = { current_period_end: "2026-09-01T00:00:00.000Z" };
  const patch = subscriptionExtendSideEffect(SPEC, payload, existing);
  assert.deepEqual(patch, { expiry_notified_at: "", renewal_failures: 0 });
});

test("current_period_end در payload نیست → دست‌نخورده (مثلاً فقط auto_renew عوض شده)", () => {
  const existing = { current_period_end: "2026-08-01T00:00:00.000Z" };
  const payload = { auto_renew: false };
  const patch = subscriptionExtendSideEffect(SPEC, payload, existing);
  assert.deepEqual(patch, {});
});

test("current_period_end همان مقدار قبلی است → دست‌نخورده", () => {
  const existing = { current_period_end: "2026-08-01T00:00:00.000Z" };
  const payload = { current_period_end: "2026-08-01T00:00:00.000Z" };
  const patch = subscriptionExtendSideEffect(SPEC, payload, existing);
  assert.deepEqual(patch, {});
});

test("مجموعه‌ی دیگر (نه member-subscriptions) هیچ‌وقت این اثر را نمی‌گیرد", () => {
  const existing = { current_period_end: "2026-08-01T00:00:00.000Z" };
  const payload = { current_period_end: "2026-09-01T00:00:00.000Z" };
  const patch = subscriptionExtendSideEffect(OTHER_SPEC, payload, existing);
  assert.deepEqual(patch, {});
});
