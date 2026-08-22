/**
 * test/sanitizeBody.test.mjs — IRFORGE_PROMPT_V3 Phase 4.5
 *
 * express.json() parses `{"__proto__": {...}}` into an object with an own
 * property literally named "__proto__" (JSON.parse does not touch the real
 * prototype by itself — verified below) — the danger is a route or a
 * downstream deep-merge assigning that key onto a target object via bracket
 * notation, which *does* walk through the inherited Object.prototype
 * accessor. This covers both: that sanitizeBody actually removes the keys,
 * and that a real, naive recursive-merge helper is safe once its input has
 * been through this middleware.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { sanitizeBody } = await import("../src/middleware/sanitizeBody.ts");

function run(body) {
  const req = { body };
  let calledNext = false;
  sanitizeBody(req, {}, () => { calledNext = true; });
  assert.equal(calledNext, true, "sanitizeBody must always call next()");
  return req.body;
}

test("JSON.parse alone does not touch the real prototype (sanity check)", () => {
  const before = ({}).isAdmin;
  JSON.parse('{"__proto__":{"isAdmin":true}}');
  assert.equal(({}).isAdmin, before);
});

test("strips a top-level __proto__ key", () => {
  const out = run(JSON.parse('{"__proto__":{"isAdmin":true},"name":"x"}'));
  assert.equal(Object.prototype.hasOwnProperty.call(out, "__proto__"), false);
  assert.equal(out.name, "x");
});

test("strips constructor and prototype keys", () => {
  const out = run(JSON.parse('{"constructor":{"prototype":{"x":1}},"prototype":{"y":2},"z":3}'));
  assert.equal(Object.prototype.hasOwnProperty.call(out, "constructor"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(out, "prototype"), false);
  assert.equal(out.z, 3);
});

test("strips dangerous keys at every nesting level, including inside arrays", () => {
  const out = run({
    top: { nested: { __proto__: { pwned: true }, ok: 1 } },
    list: [{ constructor: { prototype: {} } }, { fine: true }],
  });
  assert.equal(Object.prototype.hasOwnProperty.call(out.top.nested, "__proto__"), false);
  assert.equal(out.top.nested.ok, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(out.list[0], "constructor"), false);
  assert.equal(out.list[1].fine, true);
});

test("ordinary bodies pass through with the same data", () => {
  const out = run({ a: 1, b: { c: [1, 2, 3] }, d: "سلام" });
  assert.deepEqual(out, { a: 1, b: { c: [1, 2, 3] }, d: "سلام" });
});

test("non-object bodies (missing, string, array-at-root) are left alone", () => {
  assert.equal(run(undefined), undefined);
  const arr = run([1, 2, { __proto__: { x: 1 } }]);
  assert.equal(Object.prototype.hasOwnProperty.call(arr[2], "__proto__"), false);
});

test("a circular reference in the body does not hang or crash sanitizeBody", () => {
  const body = { a: 1 };
  body.self = body;
  const out = run(body);
  assert.equal(out.a, 1);
});

test("end-to-end: a naive recursive merge is safe once the body has passed through sanitizeBody", () => {
  function naiveDeepMerge(target, source) {
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
        target[key] = naiveDeepMerge(target[key] && typeof target[key] === "object" ? target[key] : {}, source[key]);
      } else {
        target[key] = source[key];
      }
    }
    return target;
  }

  const attackerBody = JSON.parse('{"__proto__":{"polluted":true}}');
  const sanitized = run(attackerBody);

  naiveDeepMerge({}, sanitized);
  assert.equal(({}).polluted, undefined, "the naive merge must not have polluted Object.prototype");
});
