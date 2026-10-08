/** test/botTokenHealth.test.mjs — فقط ۴۰۱ تلگرام «توکن نامعتبر» حساب می‌شود؛ خطایِ شبکه/۴۲۹/۵xx هرگز بات را خاموش نمی‌کند. */
process.env.BOT_TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
import { test } from "node:test";
import assert from "node:assert/strict";

const { isTokenRejectedByTelegram } = await import("../src/lib/botTokenHealth.ts");
const realFetch = globalThis.fetch;
const reply = (body) => { globalThis.fetch = async () => ({ json: async () => body }); };

test("401 Unauthorized → rejected", async () => {
  reply({ ok: false, error_code: 401, description: "Unauthorized" });
  assert.equal(await isTokenRejectedByTelegram("1:abc"), true);
});
test("ok / 429 / 502 → not rejected", async () => {
  reply({ ok: true, result: { id: 1 } });
  assert.equal(await isTokenRejectedByTelegram("1:abc"), false);
  reply({ ok: false, error_code: 429, description: "Too Many Requests" });
  assert.equal(await isTokenRejectedByTelegram("1:abc"), false);
  reply({ ok: false, error_code: 502, description: "Bad Gateway" });
  assert.equal(await isTokenRejectedByTelegram("1:abc"), false);
});
test("network failure → not rejected", async () => {
  globalThis.fetch = async () => { throw new Error("ECONNRESET"); };
  assert.equal(await isTokenRejectedByTelegram("1:abc"), false);
  globalThis.fetch = realFetch;
});
