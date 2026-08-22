/**
 * test/corsConfig.test.mjs — IRFORGE_PROMPT_V3 Phase 6.1
 * Run with:  pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { corsConfigIssue, resolveCorsOrigin } = await import("../src/lib/corsConfig.ts");

test("corsConfigIssue: flags production with no CORS_ORIGIN", () => {
  assert.ok(corsConfigIssue({ NODE_ENV: "production" }));
});

test("corsConfigIssue: flags production with an empty/whitespace CORS_ORIGIN", () => {
  assert.ok(corsConfigIssue({ NODE_ENV: "production", CORS_ORIGIN: "   " }));
});

test("corsConfigIssue: fine in production once CORS_ORIGIN is set", () => {
  assert.equal(corsConfigIssue({ NODE_ENV: "production", CORS_ORIGIN: "https://irforge.ir" }), null);
});

test("corsConfigIssue: never flags non-production, even with nothing set", () => {
  assert.equal(corsConfigIssue({ NODE_ENV: "development" }), null);
  assert.equal(corsConfigIssue({}), null);
});

test("resolveCorsOrigin: reflects any origin (true) when unset outside production", () => {
  assert.equal(resolveCorsOrigin({}), true);
});

test("resolveCorsOrigin: a single origin stays a plain string (not a 1-item array)", () => {
  assert.equal(resolveCorsOrigin({ CORS_ORIGIN: "https://irforge.ir" }), "https://irforge.ir");
});

test("resolveCorsOrigin: a comma-separated list becomes an array, trimmed", () => {
  assert.deepEqual(
    resolveCorsOrigin({ CORS_ORIGIN: "https://irforge.ir, https://staging.irforge.ir" }),
    ["https://irforge.ir", "https://staging.irforge.ir"],
  );
});
