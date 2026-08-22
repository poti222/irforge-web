/**
 * test/rateLimit.test.mjs — IRFORGE_PROMPT_V3 Phase 5.2
 *
 * hit() itself is DB-backed (authRateLimitsTable) and already fails open on
 * a DB error by design — with no reachable Postgres in this test
 * environment it always resolves allowed:true, so there is nothing new to
 * verify about its blocking behavior here (it's pre-existing, untouched
 * code). What Phase 5.2 adds is: a generous global per-IP limiter for all
 * of /api, per-user (not just per-IP) limiters for expensive routes, and a
 * real Retry-After header alongside the existing JSON body. Those are
 * covered here by substituting a fake `hit()` so the verdict is
 * deterministic.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const rateLimit = await import("../src/middleware/rateLimit.ts");

function fakeRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) { res.headers[name] = value; },
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
  };
  return res;
}

test("clientIp: prefers the first X-Forwarded-For entry", () => {
  const req = { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" }, ip: "9.9.9.9" };
  assert.equal(rateLimit.clientIp(req), "1.2.3.4");
});

test("clientIp: falls back to req.ip with no X-Forwarded-For", () => {
  const req = { headers: {}, ip: "9.9.9.9" };
  assert.equal(rateLimit.clientIp(req), "9.9.9.9");
});

test("perUserRateLimit: 401s if req.userId is missing (requireAuth must run first)", async () => {
  const mw = rateLimit.perUserRateLimit("test-scope", 5);
  const res = fakeRes();
  let calledNext = false;
  await mw({ headers: {} }, res, () => { calledNext = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(calledNext, false);
});

test("globalRateLimit: allows the request and calls next() when hit() allows", async () => {
  const fakeHit = async () => ({ allowed: true, retryAfterSeconds: 0 });
  const res = fakeRes();
  let calledNext = false;
  await new Promise((resolve) => {
    rateLimit.globalRateLimit({ headers: {}, ip: "1.1.1.1", path: "/api/x" }, res, () => {
      calledNext = true;
      resolve();
    }, fakeHit);
  });
  assert.equal(calledNext, true);
  assert.equal(res.statusCode, null);
});

test("globalRateLimit: sends 429 with a Retry-After header when hit() denies", async () => {
  const fakeHit = async () => ({ allowed: false, retryAfterSeconds: 42 });
  const res = fakeRes();
  let calledNext = false;
  await new Promise((resolve) => {
    rateLimit.globalRateLimit({ headers: {}, ip: "1.1.1.1", path: "/api/x" }, res, () => {
      calledNext = true;
    }, fakeHit);
    setTimeout(resolve, 10);
  });
  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers["Retry-After"], "42");
  assert.equal(res.body.code, "rate_limited");
  assert.equal(res.body.retryAfterSeconds, 42);
});

test("perUserRateLimit: sends 429 with Retry-After when the per-user limit is hit", async () => {
  let seenKey = null;
  const fakeHit = async (key) => {
    seenKey = key;
    return { allowed: false, retryAfterSeconds: 7 };
  };
  const mw = rateLimit.perUserRateLimit("bot-create", 3, undefined, fakeHit);
  const res = fakeRes();
  let calledNext = false;
  await mw({ headers: {}, userId: "user-123" }, res, () => { calledNext = true; });
  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers["Retry-After"], "7");
  assert.ok(seenKey.includes("bot-create") && seenKey.includes("user-123"));
});

test("perUserRateLimit: allows the request through when hit() allows", async () => {
  const fakeHit = async () => ({ allowed: true, retryAfterSeconds: 0 });
  const mw = rateLimit.perUserRateLimit("bot-create", 3, undefined, fakeHit);
  const res = fakeRes();
  let calledNext = false;
  await mw({ headers: {}, userId: "user-123" }, res, () => { calledNext = true; });
  assert.equal(calledNext, true);
  assert.equal(res.statusCode, null);
});

test("authRateLimit: still works and now sets a Retry-After header on 429", async () => {
  const fakeHit = async () => ({ allowed: false, retryAfterSeconds: 15 });
  const mw = rateLimit.authRateLimit("login", fakeHit);
  const res = fakeRes();
  await mw({ headers: {}, ip: "2.2.2.2" }, res, () => {});
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers["Retry-After"], "15");
});
