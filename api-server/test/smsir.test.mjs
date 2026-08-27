/**
 * test/smsir.test.mjs — IRFORGE_SMS_OTP_PROMPT Phase 1
 * Run with:  pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const smsir = await import("../src/lib/smsir.ts");

function fakeFetch(handler) {
  return async (url, opts) => handler(url, opts);
}

test("resolveApiKey: picks DEV key outside production", () => {
  const key = smsir.resolveApiKey({ NODE_ENV: "development", SMSIR_API_KEY_DEV: "dev-key", SMSIR_API_KEY_PROD: "prod-key" });
  assert.equal(key, "dev-key");
});

test("resolveApiKey: picks PROD key in production", () => {
  const key = smsir.resolveApiKey({ NODE_ENV: "production", SMSIR_API_KEY_DEV: "dev-key", SMSIR_API_KEY_PROD: "prod-key" });
  assert.equal(key, "prod-key");
});

test("resolveApiKey: falls back to plain SMSIR_API_KEY when the scoped var is unset", () => {
  const key = smsir.resolveApiKey({ NODE_ENV: "development", SMSIR_API_KEY: "shared-key" });
  assert.equal(key, "shared-key");
});

test("resolveApiKey: undefined when nothing is set", () => {
  assert.equal(smsir.resolveApiKey({}), undefined);
});

test("smsirConfigIssue: flags a missing API key", () => {
  assert.ok(smsir.smsirConfigIssue({ SMSIR_TEMPLATE_ID: "12345" }));
});

test("smsirConfigIssue: flags a missing template id", () => {
  assert.ok(smsir.smsirConfigIssue({ SMSIR_API_KEY: "k" }));
});

test("smsirConfigIssue: fine once both are set", () => {
  assert.equal(smsir.smsirConfigIssue({ SMSIR_API_KEY: "k", SMSIR_TEMPLATE_ID: "12345" }), null);
});

test("toLocalIranMobile: normalises +98, 98, and already-local forms alike", () => {
  assert.equal(smsir.toLocalIranMobile("+989121234567"), "09121234567");
  assert.equal(smsir.toLocalIranMobile("00989121234567"), "09121234567");
  assert.equal(smsir.toLocalIranMobile("989121234567"), "09121234567");
  assert.equal(smsir.toLocalIranMobile("09121234567"), "09121234567");
  assert.equal(smsir.toLocalIranMobile("9121234567"), "09121234567");
});

test("toLocalIranMobile: rejects non-Iranian-mobile input", () => {
  assert.equal(smsir.toLocalIranMobile("+15551234567"), null);
  assert.equal(smsir.toLocalIranMobile("021123"), null);
  assert.equal(smsir.toLocalIranMobile(""), null);
  assert.equal(smsir.toLocalIranMobile(null), null);
});

test("sendOtpSms: skips the network call and reports not_configured when unset", async () => {
  const result = await smsir.sendOtpSms("09121234567", "123456", {});
  assert.equal(result.success, false);
  assert.equal(result.error, "not_configured");
});

test("sendOtpSms: rejects an unrecognisable phone before making a request", async () => {
  const env = { SMSIR_API_KEY: "k", SMSIR_TEMPLATE_ID: "12345" };
  let called = false;
  const fetchFn = fakeFetch(() => {
    called = true;
    return { ok: true, json: async () => ({ status: 1 }) };
  });
  const result = await smsir.sendOtpSms("+15551234567", "123456", env, fetchFn);
  assert.equal(result.success, false);
  assert.equal(result.error, "invalid_phone");
  assert.equal(called, false);
});

test("sendOtpSms: sends X-API-KEY header and the mobile/templateId/parameters body", async () => {
  const env = { SMSIR_API_KEY: "sandbox-key-123", SMSIR_TEMPLATE_ID: "555" };
  let captured;
  const fetchFn = fakeFetch((url, opts) => {
    captured = { url, opts };
    return { ok: true, json: async () => ({ status: 1 }) };
  });

  const result = await smsir.sendOtpSms("+989121234567", "042817", env, fetchFn);

  assert.equal(result.success, true);
  assert.equal(captured.url, "https://api.sms.ir/v1/send/verify");
  assert.equal(captured.opts.headers["X-API-KEY"], "sandbox-key-123");
  const body = JSON.parse(captured.opts.body);
  assert.deepEqual(body, {
    mobile: "09121234567",
    templateId: 555,
    parameters: [{ name: "CODE", value: "042817" }],
  });
});

test("sendOtpSms: a non-2xx HTTP status is reported and not treated as success", async () => {
  const env = { SMSIR_API_KEY: "k", SMSIR_TEMPLATE_ID: "555" };
  const fetchFn = fakeFetch(() => ({ ok: false, status: 401 }));
  const result = await smsir.sendOtpSms("09121234567", "123456", env, fetchFn);
  assert.equal(result.success, false);
  assert.equal(result.error, "http_401");
});

test("sendOtpSms: HTTP 200 with a failing logical status is treated as a failure, not success", async () => {
  const env = { SMSIR_API_KEY: "k", SMSIR_TEMPLATE_ID: "555" };
  const fetchFn = fakeFetch(() => ({ ok: true, json: async () => ({ status: 4, message: "اعتبار ناکافی" }) }));
  const result = await smsir.sendOtpSms("09121234567", "123456", env, fetchFn);
  assert.equal(result.success, false);
  assert.equal(result.error, "api_status_4");
});

test("sendOtpSms: a thrown network error is caught, never propagated", async () => {
  const env = { SMSIR_API_KEY: "k", SMSIR_TEMPLATE_ID: "555" };
  const fetchFn = fakeFetch(() => {
    throw new Error("ECONNREFUSED");
  });
  const result = await smsir.sendOtpSms("09121234567", "123456", env, fetchFn);
  assert.equal(result.success, false);
  assert.equal(result.error, "request_failed");
});

test("sendOtpSms: an unparseable response body is treated as failure, not thrown", async () => {
  const env = { SMSIR_API_KEY: "k", SMSIR_TEMPLATE_ID: "555" };
  const fetchFn = fakeFetch(() => ({
    ok: true,
    json: async () => {
      throw new Error("not json");
    },
  }));
  const result = await smsir.sendOtpSms("09121234567", "123456", env, fetchFn);
  assert.equal(result.success, false);
  assert.equal(result.error, "api_status_unknown");
});
