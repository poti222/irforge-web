/**
 * test/orderGroup.test.mjs — منطقِ خالصِ بررسیِ «گروه سفارش‌ها».
 * علتِ «رسید به گروه/ادمین نمی‌رسد» باید به یک پیامِ قابل‌اقدام تبدیل شود،
 * و آی‌دیِ خراب‌کپی‌شده (بدون -100) باید امتحان شود.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";

const { orderGroupCandidates, explainSendFailure } = await import("../src/lib/orderGroup.ts");

test("ورودی خالی → هیچ کاندیدایی", () => {
  assert.deepEqual(orderGroupCandidates(""), []);
  assert.deepEqual(orderGroupCandidates("   "), []);
});

test("آی‌دی درست سوپرگروه دست‌نخورده می‌ماند", () => {
  assert.deepEqual(orderGroupCandidates("-1001234567890"), ["-1001234567890"]);
});

test("آی‌دی مثبت (منفی و 100 افتاده) با شکل‌های اصلاح‌شده هم امتحان می‌شود", () => {
  assert.deepEqual(orderGroupCandidates("1234567890"), ["1234567890", "-1001234567890", "-1234567890"]);
});

test("آی‌دی منفی بدون 100 → نسخه‌ی -100 هم امتحان می‌شود", () => {
  assert.deepEqual(orderGroupCandidates("-1234567890"), ["-1234567890", "-1001234567890"]);
});

test("گروه‌های قدیمی و کوتاه (مثل -4012345) دست‌کاری نمی‌شوند", () => {
  assert.deepEqual(orderGroupCandidates("-4012345"), ["-4012345"]);
});

test("chat not found برای گروه", () => {
  const f = explainSendFailure("Bad Request: chat not found", "group");
  assert.equal(f.code, "chat_not_found");
  assert.match(f.message, /-100/);
});

test("بات kick شده", () => {
  assert.equal(explainSendFailure("Forbidden: bot was kicked from the supergroup chat", "group").code, "bot_kicked");
  assert.equal(explainSendFailure("Forbidden: bot is not a member of the channel chat", "group").code, "bot_kicked");
});

test("بدون اجازه‌ی ارسال", () => {
  assert.equal(explainSendFailure("Bad Request: have no rights to send a message", "group").code, "no_rights");
  assert.equal(
    explainSendFailure("Bad Request: not enough rights to send text messages to the chat", "group").code,
    "no_rights",
  );
});

test("ارتقا به سوپرگروه → آی‌دی جدید پیشنهاد می‌شود", () => {
  const f = explainSendFailure("Bad Request: group chat was upgraded to a supergroup chat", "group", -1009876543210);
  assert.equal(f.code, "migrated");
  assert.equal(f.suggestedChatId, "-1009876543210");
});

test("ادمینی که بات را استارت نکرده", () => {
  const a = explainSendFailure("Forbidden: bot can't initiate conversation with a user", "admin");
  assert.equal(a.code, "user_not_started");
  const b = explainSendFailure("Forbidden: bot was blocked by the user", "admin");
  assert.equal(b.code, "user_not_started");
});

test("user not found برای ادمین پیام «کاربر» می‌دهد نه «گروه»", () => {
  const f = explainSendFailure("Bad Request: chat not found", "admin");
  assert.equal(f.code, "chat_not_found");
  assert.doesNotMatch(f.message, /-100/);
});

test("timeout و خطای ناشناخته", () => {
  assert.equal(explainSendFailure("timeout", "group").code, "timeout");
  const u = explainSendFailure("Something new", "group");
  assert.equal(u.code, "unknown");
  assert.match(u.message, /Something new/);
});
