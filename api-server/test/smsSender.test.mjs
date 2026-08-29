/**
 * test/smsSender.test.mjs — IRFORGE_PROMPT_V3 Phase 12
 * Run with:  pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const sms = await import("../src/lib/smsSender.ts");

function fakeFetch(handler) {
  return async (url, opts) => handler(url, opts);
}

test("smsConfigIssue: flags a missing gateway URL", () => {
  assert.ok(sms.smsConfigIssue({}));
});

test("smsConfigIssue: fine once SMS_GATEWAY_URL is set", () => {
  assert.equal(sms.smsConfigIssue({ SMS_GATEWAY_URL: "https://example.com/send" }), null);
});

test("sendSms: skips the network call and reports not_configured when unset", async () => {
  const result = await sms.sendSms({ to: "+15551234567", text: "hi" }, {});
  assert.equal(result.ok, false);
  assert.equal(result.error, "not_configured");
});

test("sendSms: fills the default JSON body template with to/text/apiKey", async () => {
  let captured;
  const env = { SMS_GATEWAY_URL: "https://gw.example/send", SMS_GATEWAY_API_KEY: "secret123" };
  const fetchFn = fakeFetch((url, opts) => {
    captured = { url, opts };
    return { ok: true };
  });

  const result = await sms.sendSms({ to: "+15551234567", text: "your code is 000000" }, env, fetchFn);

  assert.equal(result.ok, true);
  assert.equal(captured.url, "https://gw.example/send");
  assert.equal(captured.opts.method, "POST");
  assert.equal(captured.opts.headers.Authorization, "Bearer secret123");
  const body = JSON.parse(captured.opts.body);
  assert.deepEqual(body, { to: "+15551234567", text: "your code is 000000", apiKey: "secret123" });
});

test("sendSms: a custom body template is respected and other keys survive untouched", async () => {
  let captured;
  const env = {
    SMS_GATEWAY_URL: "https://gw.example/send",
    SMS_GATEWAY_BODY_TEMPLATE: JSON.stringify({ receptor: "{to}", message: "{text}", sender: "1000596" }),
  };
  const fetchFn = fakeFetch((url, opts) => {
    captured = opts;
    return { ok: true };
  });

  await sms.sendSms({ to: "09121234567", text: "کد شما: 123456" }, env, fetchFn);

  const body = JSON.parse(captured.body);
  assert.deepEqual(body, { receptor: "09121234567", message: "کد شما: 123456", sender: "1000596" });
});

test("sendSms: a value containing quotes/braces cannot corrupt the JSON body", async () => {
  let captured;
  const env = { SMS_GATEWAY_URL: "https://gw.example/send" };
  const fetchFn = fakeFetch((url, opts) => {
    captured = opts;
    return { ok: true };
  });

  const trickyText = 'contains "quotes", a backslash \\ and a {brace}';
  await sms.sendSms({ to: "+1", text: trickyText }, env, fetchFn);

  // JSON.parse throwing here would mean the naive string-replace approach
  // (this test exists specifically to rule out) had corrupted the body.
  const body = JSON.parse(captured.body);
  assert.equal(body.text, trickyText);
});

test("sendSms: reports the HTTP status on a non-2xx gateway response", async () => {
  const env = { SMS_GATEWAY_URL: "https://gw.example/send" };
  const fetchFn = fakeFetch(() => ({ ok: false, status: 402 }));
  const result = await sms.sendSms({ to: "+1", text: "x" }, env, fetchFn);
  assert.equal(result.ok, false);
  assert.equal(result.error, "http_402");
});

test("sendSms: a thrown network error is caught, never propagated", async () => {
  const env = { SMS_GATEWAY_URL: "https://gw.example/send" };
  const fetchFn = fakeFetch(() => { throw new Error("ECONNREFUSED"); });
  const result = await sms.sendSms({ to: "+1", text: "x" }, env, fetchFn);
  assert.equal(result.ok, false);
  assert.equal(result.error, "request_failed");
});

test("sendSms: an invalid SMS_GATEWAY_BODY_TEMPLATE falls back to the default shape instead of crashing", async () => {
  let captured;
  const env = { SMS_GATEWAY_URL: "https://gw.example/send", SMS_GATEWAY_BODY_TEMPLATE: "{not valid json" };
  const fetchFn = fakeFetch((url, opts) => {
    captured = opts;
    return { ok: true };
  });

  const result = await sms.sendSms({ to: "+1", text: "hi" }, env, fetchFn);
  assert.equal(result.ok, true);
  const body = JSON.parse(captured.body);
  assert.equal(body.to, "+1");
  assert.equal(body.text, "hi");
});
