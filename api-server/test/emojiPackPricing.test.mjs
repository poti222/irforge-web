import test from "node:test";
import assert from "node:assert/strict";
import { sortFreeFirst, canAddWithoutPaying } from "../src/lib/emojiPackPricing.ts";

const P = (slug, free) => ({ slug, free });

test("sortFreeFirst: free packs always above paid, order inside each group kept", () => {
  const out = sortFreeFirst([P("paid1", false), P("free1", true), P("paid2", false), P("free2", true)]);
  assert.deepEqual(out.map((p) => p.slug), ["free1", "free2", "paid1", "paid2"]);
});
test("sortFreeFirst: does not mutate its input", () => {
  const input = [P("a", false), P("b", true)];
  sortFreeFirst(input);
  assert.deepEqual(input.map((p) => p.slug), ["a", "b"]);
});
test("canAddWithoutPaying: free pack", () => {
  assert.equal(canAddWithoutPaying({ priceToman: 0, owned: false, isSuperAdmin: false }), true);
});
test("canAddWithoutPaying: paid and not owned must pay", () => {
  assert.equal(canAddWithoutPaying({ priceToman: 20000, owned: false, isSuperAdmin: false }), false);
});
test("canAddWithoutPaying: paid but already bought for this bot is free again", () => {
  assert.equal(canAddWithoutPaying({ priceToman: 20000, owned: true, isSuperAdmin: false }), true);
});
test("canAddWithoutPaying: super admin never pays", () => {
  assert.equal(canAddWithoutPaying({ priceToman: 20000, owned: false, isSuperAdmin: true }), true);
});
