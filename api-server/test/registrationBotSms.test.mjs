/**
 * test/registrationBotSms.test.mjs — IRFORGE_PROMPT_V3 Phase 13
 *
 * "Telegram + SMS together": sendRegistrationCode/sendLoginCode/
 * sendResetCodeSms now also text the same code to whatever phone is
 * already on file, alongside (never instead of) the existing Telegram
 * delivery. TELEGRAM_BOT_TOKEN is deliberately left unset in this test
 * process, which makes each function return right after the SMS attempt
 * instead of also trying a real Telegram call — that isolates the SMS
 * behavior here without needing to fake two transports at once.
 *
 * smsSender's sendSms is a named ESM export (read-only from the importing
 * side), so it can't be monkeypatched directly the way a plain object
 * method can — same constraint middleware/rateLimit.ts hit earlier.
 * Overriding the global `fetch` works instead: sendSms's `fetchFn`
 * parameter defaults to the free variable `fetch`, which JS resolves from
 * the global scope at *call* time, not at import time.
 *
 * Run with:  pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
delete process.env.TELEGRAM_BOT_TOKEN; // isolate the SMS path, see header

const { sendRegistrationCode, sendLoginCode, sendResetCodeSms } = await import("../src/lib/registrationBot.ts");

function withFakeSmsGateway(fn) {
  return async () => {
    const originalFetch = globalThis.fetch;
    const originalUrl = process.env.SMS_GATEWAY_URL;
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return { ok: true };
    };
    process.env.SMS_GATEWAY_URL = "https://gw.example/send";
    try {
      await fn(calls);
    } finally {
      globalThis.fetch = originalFetch;
      process.env.SMS_GATEWAY_URL = originalUrl;
    }
  };
}

test(
  "sendRegistrationCode: texts the code to the phone when one is provided",
  withFakeSmsGateway(async (calls) => {
    await sendRegistrationCode("chat1", "123456", "fa", "+15551234567");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.to, "+15551234567");
    assert.match(calls[0].body.text, /123456/);
  }),
);

test(
  "sendRegistrationCode: sends nothing over SMS when no phone is provided",
  withFakeSmsGateway(async (calls) => {
    await sendRegistrationCode("chat1", "123456", "fa");
    assert.equal(calls.length, 0);
  }),
);

test(
  "sendLoginCode: texts the code to the phone when one is provided",
  withFakeSmsGateway(async (calls) => {
    await sendLoginCode("chat1", "654321", "en", "+15559876543");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.to, "+15559876543");
    assert.match(calls[0].body.text, /654321/);
  }),
);

test(
  "sendResetCodeSms: texts the reset code when a phone is provided",
  withFakeSmsGateway(async (calls) => {
    await sendResetCodeSms("+15550001111", "999999", "fa");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.to, "+15550001111");
    assert.match(calls[0].body.text, /999999/);
  }),
);

test(
  "sendResetCodeSms: no-ops when phone is undefined",
  withFakeSmsGateway(async (calls) => {
    await sendResetCodeSms(undefined, "999999", "fa");
    assert.equal(calls.length, 0);
  }),
);

test(
  "sendRegistrationCode: still a no-op (no crash) when SMS_GATEWAY_URL is unset, phone provided",
  async () => {
    delete process.env.SMS_GATEWAY_URL;
    await sendRegistrationCode("chat1", "123456", "fa", "+15551234567");
  },
);
