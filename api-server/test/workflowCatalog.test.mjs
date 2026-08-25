/**
 * test/workflowCatalog.test.mjs — IRFORGE_PROMPT_V3 Phase 41.
 *
 * `objectsForCatalog` is pure (no sheet, no db) — every case below is a plain
 * input → output check. `FIELD_SUGGESTIONS` is a static table; the tests here
 * just guard its shape so a future edit can't silently produce a broken entry
 * (missing path/label, wrong event key typo).
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_SUGGESTIONS, objectsForCatalog } from "../src/lib/workflowCatalog.ts";

function schema(overrides = {}) {
  return {
    id: "obj1",
    name: "Products",
    slug: "products",
    fields: [{ name: "status", label: "Status", type: "select" }],
    ...overrides,
  };
}

test("objectsForCatalog projects id/name/slug/fields, nothing else", () => {
  const out = objectsForCatalog([schema()]);
  assert.deepEqual(out, [
    { id: "obj1", name: "Products", slug: "products", fields: [{ name: "status", label: "Status", type: "select" }] },
  ]);
});

test("objectsForCatalog falls back to the field's name when label is blank", () => {
  const out = objectsForCatalog([schema({ fields: [{ name: "qty", label: "", type: "number" }] })]);
  assert.equal(out[0].fields[0].label, "qty");
});

test("objectsForCatalog drops a field with no name (an in-progress, not-yet-named field)", () => {
  const out = objectsForCatalog([
    schema({ fields: [{ name: "", label: "x", type: "text" }, { name: "real", label: "Real", type: "text" }] }),
  ]);
  assert.deepEqual(out[0].fields, [{ name: "real", label: "Real", type: "text" }]);
});

test("objectsForCatalog treats a missing/null fields array as empty", () => {
  const out = objectsForCatalog([schema({ fields: undefined }), schema({ id: "obj2", fields: null })]);
  assert.deepEqual(out[0].fields, []);
  assert.deepEqual(out[1].fields, []);
});

test("objectsForCatalog handles an empty schema list", () => {
  assert.deepEqual(objectsForCatalog([]), []);
});

test("objectsForCatalog preserves schema order", () => {
  const out = objectsForCatalog([schema({ id: "a" }), schema({ id: "b" }), schema({ id: "c" })]);
  assert.deepEqual(out.map((o) => o.id), ["a", "b", "c"]);
});

// ── FIELD_SUGGESTIONS shape ──────────────────────────────────────────────

test("FIELD_SUGGESTIONS only covers non-object events (event.object.* is dynamic, from objectsForCatalog)", () => {
  for (const key of Object.keys(FIELD_SUGGESTIONS)) {
    assert.equal(key.startsWith("event.object."), false, `${key} should not be a static suggestion`);
  }
});

test("FIELD_SUGGESTIONS covers every payment and wallet event this route's EVENT_NAMES exposes", () => {
  const expected = [
    "event.payment.approved",
    "event.payment.rejected",
    "event.wallet.transaction",
    "event.wallet.frozen",
    "event.wallet.unfrozen",
  ];
  for (const key of expected) {
    assert.ok(Array.isArray(FIELD_SUGGESTIONS[key]) && FIELD_SUGGESTIONS[key].length > 0, `missing suggestions for ${key}`);
  }
});

test("every FIELD_SUGGESTIONS entry has a non-empty path and label, and paths within an event are unique", () => {
  for (const [event, fields] of Object.entries(FIELD_SUGGESTIONS)) {
    const seen = new Set();
    for (const f of fields) {
      assert.equal(typeof f.path, "string");
      assert.notEqual(f.path.trim(), "", `${event} has a blank path`);
      assert.equal(typeof f.label, "string");
      assert.notEqual(f.label.trim(), "", `${event}.${f.path} has a blank label`);
      assert.equal(seen.has(f.path), false, `${event} has a duplicate path ${f.path}`);
      seen.add(f.path);
    }
  }
});
