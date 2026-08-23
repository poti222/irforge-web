/**
 * test/authEmails.test.mjs — IRFORGE_PROMPT_V3 Phase 14
 * Run with:  pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const authEmails = await import("../src/lib/authEmails.ts");

test("buildRegistrationCodeEmail: the code appears in html and text for every supported locale", () => {
  for (const locale of ["fa", "en", "ar", "tr", "ru"]) {
    const built = authEmails.buildRegistrationCodeEmail("482913", locale);
    assert.ok(built.html.includes("482913"), `html must contain the code for locale ${locale}`);
    assert.ok(built.text.includes("482913"), `text must contain the code for locale ${locale}`);
    assert.ok(built.subject.length > 0);
  }
});

test("buildLoginCodeEmail: the code appears in html and text for every supported locale", () => {
  for (const locale of ["fa", "en", "ar", "tr", "ru"]) {
    const built = authEmails.buildLoginCodeEmail("117733", locale);
    assert.ok(built.html.includes("117733"), `html must contain the code for locale ${locale}`);
    assert.ok(built.text.includes("117733"), `text must contain the code for locale ${locale}`);
  }
});

test("buildRegistrationCodeEmail: subjects differ across locales (not one copy-pasted string)", () => {
  const subjects = new Set(
    ["fa", "en", "ar", "tr", "ru"].map((l) => authEmails.buildRegistrationCodeEmail("000000", l).subject),
  );
  assert.equal(subjects.size, 5);
});

test("buildRegistrationCodeEmail: an unknown/missing locale falls back to fa, not a crash", () => {
  const fallback = authEmails.buildRegistrationCodeEmail("555555", "xx");
  const noLocale = authEmails.buildRegistrationCodeEmail("555555", undefined);
  const fa = authEmails.buildRegistrationCodeEmail("555555", "fa");
  assert.equal(fallback.subject, fa.subject);
  assert.equal(noLocale.subject, fa.subject);
});

test("buildLoginCodeEmail: registration and login copy are distinct (no accidental swap)", () => {
  const reg = authEmails.buildRegistrationCodeEmail("999999", "en");
  const login = authEmails.buildLoginCodeEmail("999999", "en");
  assert.notEqual(reg.subject, login.subject);
  assert.notEqual(reg.html, login.html);
});

test("sendEmailRegistrationCode: never throws when SMTP is not configured", async () => {
  const savedHost = process.env.SMTP_HOST;
  delete process.env.SMTP_HOST;
  try {
    await assert.doesNotReject(authEmails.sendEmailRegistrationCode("a@example.com", "123456", "en"));
  } finally {
    if (savedHost !== undefined) process.env.SMTP_HOST = savedHost;
  }
});

test("sendEmailLoginCode: never throws when SMTP is not configured", async () => {
  const savedHost = process.env.SMTP_HOST;
  delete process.env.SMTP_HOST;
  try {
    await assert.doesNotReject(authEmails.sendEmailLoginCode("a@example.com", "654321", "fa"));
  } finally {
    if (savedHost !== undefined) process.env.SMTP_HOST = savedHost;
  }
});
