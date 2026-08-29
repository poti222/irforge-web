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

// ─── sms.ir (SMS_PROVIDER=sms.ir) ───────────────────────────────────────────

function fakeJsonFetch(handler) {
  return async (url, opts) => {
    const result = handler(url, opts);
    return { ok: result.ok !== false, status: result.status ?? 200, json: async () => result.body ?? { status: 1 } };
  };
}

test("smsConfigIssue: sms.ir flags a missing API key", () => {
  assert.ok(sms.smsConfigIssue({ SMS_PROVIDER: "sms.ir" }));
});

test("smsConfigIssue: sms.ir flags missing template id AND line number", () => {
  assert.ok(sms.smsConfigIssue({ SMS_PROVIDER: "sms.ir", SMS_IR_API_KEY: "k" }));
});

test("smsConfigIssue: sms.ir is fine with a template id alone", () => {
  assert.equal(
    sms.smsConfigIssue({ SMS_PROVIDER: "sms.ir", SMS_IR_API_KEY: "k", SMS_IR_TEMPLATE_ID: "123" }),
    null,
  );
});

test("sendSms: sms.ir verify path posts mobile/templateId/parameters with x-api-key, not the composed sentence", async () => {
  let captured;
  const env = {
    SMS_PROVIDER: "sms.ir",
    SMS_IR_API_KEY: "test-key",
    SMS_IR_TEMPLATE_ID: "100455",
  };
  const fetchFn = fakeJsonFetch((url, opts) => {
    captured = { url, opts };
    return { ok: true, body: { status: 1, message: "موفق" } };
  });

  const result = await sms.sendSms(
    { to: "09121234567", text: "کد ورود IrForge: 123456\nتا ۵ دقیقه معتبر است.", code: "123456" },
    env,
    fetchFn,
  );

  assert.equal(result.ok, true);
  assert.equal(result.provider, "sms.ir");
  assert.equal(captured.url, "https://api.sms.ir/v1/send/verify");
  assert.equal(captured.opts.headers["x-api-key"], "test-key");
  assert.equal(captured.opts.headers.Authorization, undefined, "sms.ir does not use Bearer auth");
  const body = JSON.parse(captured.opts.body);
  assert.deepEqual(body, {
    mobile: "09121234567",
    templateId: 100455,
    parameters: [{ name: "Code", value: "123456" }],
  });
});

test("sendSms: sms.ir verify path uses a custom template parameter name when configured", async () => {
  let captured;
  const env = {
    SMS_PROVIDER: "sms.ir",
    SMS_IR_API_KEY: "k",
    SMS_IR_TEMPLATE_ID: "1",
    SMS_IR_TEMPLATE_PARAM: "VerificationCode",
  };
  const fetchFn = fakeJsonFetch((url, opts) => {
    captured = opts;
    return { ok: true, body: { status: 1 } };
  });

  await sms.sendSms({ to: "0912", text: "x", code: "9999" }, env, fetchFn);
  const body = JSON.parse(captured.body);
  assert.deepEqual(body.parameters, [{ name: "VerificationCode", value: "9999" }]);
});

test("sendSms: sms.ir bulk path is used when only a line number is configured", async () => {
  let captured;
  const env = { SMS_PROVIDER: "sms.ir", SMS_IR_API_KEY: "k", SMS_IR_LINE_NUMBER: "30007732000000" };
  const fetchFn = fakeJsonFetch((url, opts) => {
    captured = { url, opts };
    return { ok: true, body: { status: 1 } };
  });

  await sms.sendSms({ to: "0912", text: "hello" }, env, fetchFn);
  assert.equal(captured.url, "https://api.sms.ir/v1/send/bulk");
  const body = JSON.parse(captured.opts.body);
  assert.deepEqual(body, { lineNumber: "30007732000000", messageText: "hello", mobiles: ["0912"] });
});

test("sendSms: sms.ir prefers the verify template over a line number when both are set", async () => {
  let captured;
  const env = {
    SMS_PROVIDER: "sms.ir", SMS_IR_API_KEY: "k",
    SMS_IR_TEMPLATE_ID: "1", SMS_IR_LINE_NUMBER: "30007732000000",
  };
  const fetchFn = fakeJsonFetch((url) => { captured = url; return { ok: true, body: { status: 1 } }; });

  await sms.sendSms({ to: "0912", text: "x", code: "1" }, env, fetchFn);
  assert.equal(captured, "https://api.sms.ir/v1/send/verify");
});

test("sendSms: sms.ir reports not_configured with neither template id nor line number", async () => {
  const result = await sms.sendSms({ to: "0912", text: "x" }, { SMS_PROVIDER: "sms.ir", SMS_IR_API_KEY: "k" });
  assert.equal(result.ok, false);
  assert.equal(result.provider, "sms.ir");
  assert.equal(result.error, "not_configured");
});

test("sendSms: sms.ir reports not_configured without an API key even if a template id is set", async () => {
  const result = await sms.sendSms({ to: "0912", text: "x" }, { SMS_PROVIDER: "sms.ir", SMS_IR_TEMPLATE_ID: "1" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "not_configured");
});

test("sendSms: sms.ir treats a 200 response with a non-1 status as a failure (e.g. bad templateId)", async () => {
  const env = { SMS_PROVIDER: "sms.ir", SMS_IR_API_KEY: "k", SMS_IR_TEMPLATE_ID: "999" };
  const fetchFn = fakeJsonFetch(() => ({ ok: true, body: { status: 4, message: "قالب یافت نشد" } }));

  const result = await sms.sendSms({ to: "0912", text: "x", code: "1" }, env, fetchFn);
  assert.equal(result.ok, false);
  assert.equal(result.error, "smsir_4");
});

test("sendSms: sms.ir reports the HTTP status on a non-2xx gateway response", async () => {
  const env = { SMS_PROVIDER: "sms.ir", SMS_IR_API_KEY: "k", SMS_IR_TEMPLATE_ID: "1" };
  const fetchFn = fakeJsonFetch(() => ({ ok: false, status: 401 }));

  const result = await sms.sendSms({ to: "0912", text: "x", code: "1" }, env, fetchFn);
  assert.equal(result.ok, false);
  assert.equal(result.error, "http_401");
});

test("sendSms: sms.ir catches a thrown network error, never propagates", async () => {
  const env = { SMS_PROVIDER: "sms.ir", SMS_IR_API_KEY: "k", SMS_IR_TEMPLATE_ID: "1" };
  const fetchFn = async () => { throw new Error("ECONNREFUSED"); };

  const result = await sms.sendSms({ to: "0912", text: "x", code: "1" }, env, fetchFn);
  assert.equal(result.ok, false);
  assert.equal(result.error, "request_failed");
});

test("sendSms: SMS_PROVIDER unset (or anything else) keeps using the generic gateway path", async () => {
  let called = false;
  const env = { SMS_GATEWAY_URL: "https://gw.example/send" };
  const fetchFn = fakeFetch(() => { called = true; return { ok: true }; });

  const result = await sms.sendSms({ to: "+1", text: "hi" }, env, fetchFn);
  assert.equal(called, true);
  assert.equal(result.provider, "http");
});
