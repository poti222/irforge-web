import test from "node:test";
import assert from "node:assert/strict";
// lib/db در لحظه‌ی import به DATABASE_URL نیاز دارد؛ اتصالی باز نمی‌شود (pool تنبل است).
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
const { classifyDiagnosis, ownerMessage, emptyReport } = await import("../src/lib/sheetPoolRepair.ts");

const d = (over) => ({ ok: false, serviceAccountEmail: "sa@x", ...over });

test("ok diagnosis is ok", () => {
  assert.equal(classifyDiagnosis({ ok: true, serviceAccountEmail: "sa@x" }), "ok");
});

test("403 PERMISSION_DENIED is broken", () => {
  assert.equal(classifyDiagnosis(d({ httpStatus: 403, googleReason: "PERMISSION_DENIED" })), "broken");
  assert.equal(classifyDiagnosis(d({ httpStatus: 403, message: "The caller does not have permission" })), "broken");
});

test("404 / notFound is broken", () => {
  assert.equal(classifyDiagnosis(d({ httpStatus: 404 })), "broken");
  assert.equal(classifyDiagnosis(d({ googleReason: "NOT_FOUND" })), "broken");
});

test("rate limits, 5xx and network errors are unknown, never broken", () => {
  assert.equal(classifyDiagnosis(d({ httpStatus: 429 })), "unknown");
  assert.equal(classifyDiagnosis(d({ httpStatus: 403, googleReason: "rateLimitExceeded" })), "unknown");
  assert.equal(classifyDiagnosis(d({ httpStatus: 403, googleReason: "RESOURCE_EXHAUSTED_QUOTA" })), "unknown");
  assert.equal(classifyDiagnosis(d({ httpStatus: 500 })), "unknown");
  assert.equal(classifyDiagnosis(d({ httpStatus: 503 })), "unknown");
  assert.equal(classifyDiagnosis(d({ message: "getaddrinfo ENOTFOUND" })), "unknown");
  assert.equal(classifyDiagnosis(d({})), "unknown");
});

test("owner message names the bot and needs no action", () => {
  const m = ownerMessage("کوزه سازان");
  assert.ok(m.title.includes("کوزه سازان"));
  assert.ok(m.message.includes("نیازی به هیچ کاری"));
});

test("empty report starts at zero", () => {
  const r = emptyReport("dry");
  assert.equal(r.mode, "dry");
  assert.equal(r.bots.repaired, 0);
  assert.equal(r.spares.removed, 0);
  assert.deepEqual(r.items, []);
});
