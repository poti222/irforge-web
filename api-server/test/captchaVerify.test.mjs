/**
 * test/captchaVerify.test.mjs — IRFORGE_PROMPT_V3 Phase 42.
 *
 * `verifyCaptchaToken` reads settings through platformSettings.ts's
 * `getCaptchaSettings()` (DB-backed, same `db.select` fake as
 * platformSettings.test.mjs) and calls out to Cloudflare's siteverify via
 * global `fetch`, which is stubbed here so no real network call happens.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const { db } = await import("@workspace/db");
const { verifyCaptchaToken } = await import("../src/lib/captchaVerify.ts");
const { CAPTCHA_KEY } = await import("../src/lib/platformSettings.ts");

function installDb(row) {
  db.select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => (row ? [row] : []),
      }),
    }),
  });
}

function captchaRow(value) {
  return { key: CAPTCHA_KEY, value: JSON.stringify(value) };
}

function enableCaptcha() {
  installDb(captchaRow({ enabled: true, siteKey: "0x4AAAAAAA" }));
  process.env.TURNSTILE_SECRET_KEY = "0xSECRET";
}

function cleanupEnv() {
  delete process.env.TURNSTILE_SECRET_KEY;
}

function installFetch(impl) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return impl(url, init);
  };
  return calls;
}

test("gate disabled (no row, no env): allows through without ever calling fetch", async () => {
  installDb(null);
  const calls = installFetch(() => { throw new Error("should not be called"); });

  const ok = await verifyCaptchaToken("any-token");

  assert.equal(ok, true);
  assert.equal(calls.length, 0);
});

test("gate enabled but TURNSTILE_SECRET_KEY missing: allows through (misconfiguration fails open)", async () => {
  installDb(captchaRow({ enabled: true, siteKey: "0x4AAAAAAA" }));
  cleanupEnv();
  const calls = installFetch(() => { throw new Error("should not be called"); });

  const ok = await verifyCaptchaToken("any-token");

  assert.equal(ok, true);
  assert.equal(calls.length, 0);
});

test("gate enabled + secret set, but no token given: rejected without calling fetch", async () => {
  enableCaptcha();
  const calls = installFetch(() => { throw new Error("should not be called"); });

  const ok = await verifyCaptchaToken(undefined);

  assert.equal(ok, false);
  assert.equal(calls.length, 0);
  cleanupEnv();
});

test("gate enabled + secret set, blank/whitespace token: rejected without calling fetch", async () => {
  enableCaptcha();
  const calls = installFetch(() => { throw new Error("should not be called"); });

  const ok = await verifyCaptchaToken("   ");

  assert.equal(ok, false);
  assert.equal(calls.length, 0);
  cleanupEnv();
});

test("gate enabled + secret set + real token: Turnstile success:true → allowed", async () => {
  enableCaptcha();
  installFetch(() => ({ ok: true, json: async () => ({ success: true }) }));

  const ok = await verifyCaptchaToken("real-token");

  assert.equal(ok, true);
  cleanupEnv();
});

test("gate enabled + secret set + real token: Turnstile success:false → rejected", async () => {
  enableCaptcha();
  installFetch(() => ({ ok: true, json: async () => ({ success: false }) }));

  const ok = await verifyCaptchaToken("bad-token");

  assert.equal(ok, false);
  cleanupEnv();
});

test("Turnstile responds non-2xx: fails open (allowed)", async () => {
  enableCaptcha();
  installFetch(() => ({ ok: false, status: 503, json: async () => ({}) }));

  const ok = await verifyCaptchaToken("real-token");

  assert.equal(ok, true);
  cleanupEnv();
});

test("network error talking to Turnstile: fails open (allowed)", async () => {
  enableCaptcha();
  installFetch(() => { throw new Error("ECONNRESET"); });

  const ok = await verifyCaptchaToken("real-token");

  assert.equal(ok, true);
  cleanupEnv();
});

test("posts secret, response and remoteip to Turnstile's siteverify endpoint", async () => {
  enableCaptcha();
  const calls = installFetch(() => ({ ok: true, json: async () => ({ success: true }) }));

  await verifyCaptchaToken("real-token", "203.0.113.5");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.equal(calls[0].init.method, "POST");
  const body = calls[0].init.body;
  assert.equal(body.get("secret"), "0xSECRET");
  assert.equal(body.get("response"), "real-token");
  assert.equal(body.get("remoteip"), "203.0.113.5");
  cleanupEnv();
});

test("omits remoteip when not provided", async () => {
  enableCaptcha();
  const calls = installFetch(() => ({ ok: true, json: async () => ({ success: true }) }));

  await verifyCaptchaToken("real-token");

  assert.equal(calls[0].init.body.has("remoteip"), false);
  cleanupEnv();
});
