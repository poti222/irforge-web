/**
 * test/otp.test.mjs — IRFORGE_PROMPT_V3 Phase 4.6
 *
 * The OTP hash salt used to be the fixed string "irforge_otp" — a
 * precomputable rainbow table for every 6-digit code. This covers the fix:
 * HMAC keyed by OTP_SECRET, a boot refusal when that secret is missing (or
 * too short) in production, and that generateCode()/verifyCode() still
 * behave correctly end to end.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
delete process.env.OTP_SECRET; // this process's NODE_ENV isn't "production", so import must still succeed

const otp = await import("../src/lib/otp.ts");

test("otpSecretConfigIssue: fine outside production even with no secret", () => {
  assert.equal(otp.otpSecretConfigIssue({ NODE_ENV: "development" }), null);
  assert.equal(otp.otpSecretConfigIssue({ NODE_ENV: "test" }), null);
  assert.equal(otp.otpSecretConfigIssue({}), null);
});

test("otpSecretConfigIssue: refuses production with no OTP_SECRET", () => {
  const issue = otp.otpSecretConfigIssue({ NODE_ENV: "production" });
  assert.ok(issue && issue.includes("OTP_SECRET"));
});

test("otpSecretConfigIssue: refuses production with a short OTP_SECRET", () => {
  const issue = otp.otpSecretConfigIssue({ NODE_ENV: "production", OTP_SECRET: "short" });
  assert.ok(issue && issue.includes("OTP_SECRET"));
});

test("otpSecretConfigIssue: accepts production with a long OTP_SECRET", () => {
  const issue = otp.otpSecretConfigIssue({
    NODE_ENV: "production",
    OTP_SECRET: "a".repeat(32),
  });
  assert.equal(issue, null);
});

test("hashCode no longer matches the old fixed-salt scheme", () => {
  const code = "123456";
  const oldScheme = crypto.createHash("sha256").update(code + "irforge_otp").digest("hex");
  assert.notEqual(otp.hashCode(code), oldScheme);
});

test("hashCode is deterministic for the same code", () => {
  assert.equal(otp.hashCode("042017"), otp.hashCode("042017"));
});

test("hashCode trims the input the same way verifyCode does", () => {
  assert.equal(otp.hashCode("  123456  "), otp.hashCode("123456"));
});

test("generateCode produces a zero-padded 6-digit string", () => {
  for (let i = 0; i < 50; i++) {
    const code = otp.generateCode();
    assert.equal(code.length, otp.CODE_LENGTH);
    assert.match(code, /^\d{6}$/);
  }
});

test("verifyCode: correct code against its own hash passes", () => {
  const code = otp.generateCode();
  assert.equal(otp.verifyCode(code, otp.hashCode(code)), true);
});

test("verifyCode: wrong code fails", () => {
  assert.equal(otp.verifyCode("000000", otp.hashCode("111111")), false);
});

test("verifyCode: missing stored hash or empty input fails safely", () => {
  assert.equal(otp.verifyCode("123456", null), false);
  assert.equal(otp.verifyCode("123456", undefined), false);
  assert.equal(otp.verifyCode("", otp.hashCode("123456")), false);
});

test("isExpired / codeExpiry round-trip", () => {
  assert.equal(otp.isExpired(null), true);
  assert.equal(otp.isExpired(otp.codeExpiry()), false);
  assert.equal(otp.isExpired(new Date(Date.now() - 1000)), true);
});
