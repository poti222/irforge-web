/**
 * test/botOrders.test.mjs — IRFORGE_RECEIPT_DEBUG_INVOICES_PROMPT Part 2
 *
 * The new "Invoices" admin section is a NEW VIEW on the same `payments`
 * data `routes/botOrders.ts` already reads for Orders — not a separate
 * data model (see PROGRESS.md for why). The only new logic on the backend
 * is the open/closed bucket mapping (`bucketOf`/`computeBucketCounts`),
 * kept as small, pure, directly-exported functions — matching this repo's
 * existing convention for a route file's helpers (precedent: `ORDER_STATUSES`
 * itself, already exported straight off this same file). Everything else
 * (search, pagination, currency, invoice_number pass-through) reuses the
 * Orders route's own existing, already-covered behavior.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const { ORDER_STATUSES, bucketOf, computeBucketCounts } = await import("../src/routes/botOrders.ts");

test("bucketOf: pending is open (awaiting admin review)", () => {
  assert.equal(bucketOf("pending"), "open");
});

test("bucketOf: postponed is open (not a final outcome yet)", () => {
  assert.equal(bucketOf("postponed"), "open");
});

test("bucketOf: verified is closed", () => {
  assert.equal(bucketOf("verified"), "closed");
});

test("bucketOf: rejected is closed (a final outcome, even though unfavorable)", () => {
  assert.equal(bucketOf("rejected"), "closed");
});

test("bucketOf: every ORDER_STATUSES value maps to exactly one bucket (no gaps, no drift)", () => {
  for (const status of ORDER_STATUSES) {
    assert.ok(["open", "closed"].includes(bucketOf(status)), `unexpected bucket for status "${status}"`);
  }
});

test("computeBucketCounts: tallies a mixed list correctly", () => {
  const orders = [
    { status: "pending" },
    { status: "pending" },
    { status: "postponed" },
    { status: "verified" },
    { status: "rejected" },
    { status: "rejected" },
  ];
  assert.deepEqual(computeBucketCounts(orders), { open: 3, closed: 3 });
});

test("computeBucketCounts: a missing status defaults to pending, i.e. open (matches readOrders' own default)", () => {
  assert.deepEqual(computeBucketCounts([{}]), { open: 1, closed: 0 });
});

test("computeBucketCounts: an empty list is all zeros, not undefined/NaN", () => {
  assert.deepEqual(computeBucketCounts([]), { open: 0, closed: 0 });
});
