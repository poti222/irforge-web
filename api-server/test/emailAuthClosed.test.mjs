/**
 * test/emailAuthClosed.test.mjs
 *
 * ورود/ثبت‌نام با ایمیل به‌طور کامل بسته شده (lib/authPolicy.ts). سه نقطه‌ی
 * ورودیِ ایمیل‌محور باید همگی این چک را از همان ابتدای handler رد کنند —
 * پیش از هر کارِ دیگری (چک کپچا، خواندن دیتابیس، ساختن کد) — دقیقاً همان
 * سبکِ source-text که test/loginEmailFlow.test.mjs و
 * test/registrationEmailFlow.test.mjs برای همین دو مسیر استفاده می‌کنند،
 * چون این مخزن زیرساخت تستِ یکپارچه با دیتابیسِ واقعی ندارد.
 *
 * `/auth/forgot-password` عمداً این‌جا نیست: از اول هم کدش را از تلگرام
 * می‌فرستد، نه ایمیل — «ایمیل» آن‌جا فقط کلیدِ جست‌وجوست، نه یک کانالِ ورود.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const authSrc = readFileSync(join(here, "../src/routes/auth.ts"), "utf8");
const registrationSrc = readFileSync(join(here, "../src/routes/registration.ts"), "utf8");
const policy = await import("../src/lib/authPolicy.ts");

test("EMAIL_AUTH_CLOSED is on", () => {
  assert.equal(policy.EMAIL_AUTH_CLOSED, true);
});

test("POST /auth/register (legacy email+password) checks EMAIL_AUTH_CLOSED before touching the database", () => {
  const block = authSrc.slice(
    authSrc.indexOf('router.post("/auth/register",'),
    authSrc.indexOf('router.post("/auth/login",'),
  );
  const guardAt = block.indexOf("EMAIL_AUTH_CLOSED");
  const dbAt = block.indexOf("emailEquals(email)");
  assert.ok(guardAt !== -1, "no EMAIL_AUTH_CLOSED check found in /auth/register");
  assert.ok(dbAt !== -1, "expected a database read via emailEquals(email) in /auth/register");
  assert.ok(guardAt < dbAt, "the closed-check must run before any database read");
});

test("POST /auth/login rejects the email identifier specifically, leaving the phone path untouched", () => {
  const block = authSrc.slice(
    authSrc.indexOf('router.post("/auth/login",'),
    authSrc.indexOf('router.post("/auth/login/verify"'),
  );
  assert.match(block, /if \(EMAIL_AUTH_CLOSED && email\)/);
  // still resolves phone vs email exactly as before — only a new check was added, not a rewrite
  assert.match(block, /const email = !phone && req\.body\?\.email/);
});

test("POST /auth/register/email/start checks EMAIL_AUTH_CLOSED before sending any code", () => {
  const block = registrationSrc.slice(
    registrationSrc.indexOf('router.post("/auth/register/email/start",'),
    registrationSrc.indexOf('router.get("/auth/register/:id/status"'),
  );
  const guardAt = block.indexOf("EMAIL_AUTH_CLOSED");
  const sendAt = block.indexOf("sendEmailRegistrationCode");
  assert.ok(guardAt !== -1, "no EMAIL_AUTH_CLOSED check found in /auth/register/email/start");
  assert.ok(guardAt < sendAt, "the closed-check must run before a code is ever sent");
});

test("POST /auth/forgot-password needs no EMAIL_AUTH_CLOSED check — it's phone-keyed, not email", () => {
  const block = authSrc.slice(
    authSrc.indexOf('router.post("/auth/forgot-password",'),
    authSrc.indexOf('router.post("/auth/reset-password"'),
  );
  assert.doesNotMatch(block, /EMAIL_AUTH_CLOSED/);
  assert.match(block, /normalizePhone\(req\.body\?\.phone\)/, "forgot-password looks accounts up by phone");
});
