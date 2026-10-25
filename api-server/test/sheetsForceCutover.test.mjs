import test from "node:test";
import assert from "node:assert/strict";
import { planForce } from "../src/lib/sheetsForcePlan.ts";

const base = { hasSheet: true, inFlight: false, hasAnyRequest: true, postgresEntityCount: 69, totalEntityCount: 83 };

test("planForce: partial bot is force-switched", () => {
  assert.equal(planForce(base), "force_switch");
});
test("planForce: 0/83 after a finished attempt is force-switched", () => {
  assert.equal(planForce({ ...base, postgresEntityCount: 0 }), "force_switch");
});
test("planForce: no sheet is skipped", () => {
  assert.equal(planForce({ ...base, hasSheet: false }), "no_sheet");
});
test("planForce: in-flight import is never touched", () => {
  assert.equal(planForce({ ...base, inFlight: true }), "in_flight");
});
test("planForce: already complete needs nothing", () => {
  assert.equal(planForce({ ...base, postgresEntityCount: 83 }), "already_complete");
});
test("planForce: never attempted and nothing flagged only queues an import", () => {
  assert.equal(planForce({ ...base, hasAnyRequest: false, postgresEntityCount: 0 }), "never_imported");
});
test("planForce: no request but some flags already on is force-switched", () => {
  assert.equal(planForce({ ...base, hasAnyRequest: false, postgresEntityCount: 5 }), "force_switch");
});
