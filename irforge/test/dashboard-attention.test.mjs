/**
 * test/dashboard-attention.test.mjs — IRFORGE_PROMPT_V3 Phase 49
 *
 * Covers src/lib/dashboard-attention.ts: which bots the dashboard's "needs
 * attention" panel surfaces, and why.
 *
 * Run with: pnpm --filter @workspace/irforge run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { attentionReason, botsNeedingAttention } = await import("../src/lib/dashboard-attention.ts");

function bot(overrides = {}) {
  return { status: "active", isTrial: false, trialDaysLeft: null, ...overrides };
}

test("attentionReason: an expired bot is flagged expired", () => {
  assert.equal(attentionReason(bot({ status: "expired" })), "expired");
});

test("attentionReason: a bot in error state is flagged error", () => {
  assert.equal(attentionReason(bot({ status: "error" })), "error");
});

test("attentionReason: a rejected payment is flagged paymentRejected", () => {
  assert.equal(attentionReason(bot({ status: "payment_rejected" })), "paymentRejected");
});

test("attentionReason: an awaiting-payment bot is flagged pendingPayment", () => {
  assert.equal(attentionReason(bot({ status: "pending_payment" })), "pendingPayment");
});

test("attentionReason: a trial with 3 days or fewer left is flagged trialEndingSoon", () => {
  assert.equal(attentionReason(bot({ isTrial: true, trialDaysLeft: 3 })), "trialEndingSoon");
  assert.equal(attentionReason(bot({ isTrial: true, trialDaysLeft: 0 })), "trialEndingSoon");
});

test("attentionReason: a trial with more than 3 days left is not flagged", () => {
  assert.equal(attentionReason(bot({ isTrial: true, trialDaysLeft: 4 })), null);
});

test("attentionReason: a non-trial bot with a null trialDaysLeft is never flagged for it", () => {
  assert.equal(attentionReason(bot({ isTrial: false, trialDaysLeft: null })), null);
});

test("attentionReason: isTrial true but trialDaysLeft null is not flagged (nothing to warn about yet)", () => {
  assert.equal(attentionReason(bot({ isTrial: true, trialDaysLeft: null })), null);
});

test("attentionReason: an active, non-trial bot is never flagged", () => {
  assert.equal(attentionReason(bot({ status: "active" })), null);
});

test("attentionReason: inactive and deploying are not attention states", () => {
  assert.equal(attentionReason(bot({ status: "inactive" })), null);
  assert.equal(attentionReason(bot({ status: "deploying" })), null);
});

test("attentionReason: an explicit status wins over a soon-to-expire trial", () => {
  // status already communicates something more specific than "trial ending".
  assert.equal(attentionReason(bot({ status: "error", isTrial: true, trialDaysLeft: 1 })), "error");
});

test("botsNeedingAttention: filters to only the flagged bots, keeping the reason alongside", () => {
  const bots = [
    bot({ status: "active" }),
    bot({ status: "expired" }),
    bot({ isTrial: true, trialDaysLeft: 2 }),
    bot({ status: "inactive" }),
  ];
  const result = botsNeedingAttention(bots);
  assert.equal(result.length, 2);
  assert.equal(result[0].reason, "expired");
  assert.equal(result[0].bot, bots[1]);
  assert.equal(result[1].reason, "trialEndingSoon");
  assert.equal(result[1].bot, bots[2]);
});

test("botsNeedingAttention: an empty list yields an empty result", () => {
  assert.deepEqual(botsNeedingAttention([]), []);
});
