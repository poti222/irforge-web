/**
 * authHardening.test.mjs
 * قفل‌کردنِ اصلاحاتِ امنیتیِ مسیرهای ورود/ثبت‌نام/بازیابی (بازبینی ۱۴۰۵).
 * هر تست یک رفتارِ حیاتی را روی سورس پین می‌کند — مثل بقیه‌ی تست‌های auth این مخزن.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, "../src", p), "utf8");
const auth = read("routes/auth.ts");
const reg = read("routes/registration.ts");
const signup = read("routes/signup.ts");
const rate = read("middleware/rateLimit.ts");
const hook = read("routes/telegramWebhook.ts");
const between = (src, a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a) + 1));

test("rate limiter hit() is a single atomic upsert, not select-then-update", () => {
  const block = between(rate, "export async function hit(", "export async function reset(");
  assert.match(block, /ON CONFLICT \(key\) DO UPDATE/);
  assert.ok(!block.includes(".select()"), "hit() must not read the row separately");
});

test("SMS OTP send endpoint is rate limited", () => {
  assert.match(auth, /router\.post\("\/auth\/otp\/sms\/send", smsOtpSendRateLimit\(\)/);
});

test("SMS OTP verify: a code killed by too many attempts is expired, never marked consumed (consumed == proof of ownership)", () => {
  const block = between(auth, "if (attempts > MAX_CODE_ATTEMPTS) {\n      // ⛔ کدِ کشته‌شده", "if (!verifyOtp(");
  assert.match(block, /expiresAt: new Date\(Date\.now\(\) - 1000\)/);
  assert.ok(!/\.set\(\{[^}]*consumedAt/.test(block), "kill branch must not set consumedAt");
});

test("recentSmsRegisterProof ignores rows that exceeded the attempt cap, and proofs are single-use", () => {
  const block = between(reg, "export async function recentSmsRegisterProof", "// ─── POST /api/auth/register/sms/complete");
  assert.match(block, /attempts\} <= \$\{MAX_CODE_ATTEMPTS\}/);
  assert.match(block, /register_used/);
});

test("reset-password counts attempts on the code and revokes sessions after a reset", () => {
  const block = between(auth, 'router.post("/auth/reset-password"', "// ═══");
  assert.match(block, /hit\(resetTryKey\(user\.id\)/);
  assert.match(block, /delete\(sessionsTable\)/);
  assert.match(block, /resetCodeHash: null/);
});

test("forgot-password supports the Telegram bot channel and equalises response time", () => {
  const block = between(auth, 'router.post("/auth/forgot-password"', 'router.post("/auth/reset-password"');
  assert.match(block, /method === "telegram"/);
  assert.match(block, /sendResetCodeTelegram/);
  assert.match(block, /floor/);
});

test("Google/GitHub sign-in never auto-links an account whose email is unverified", () => {
  const matches = auth.match(/if \(user && !user\.emailVerified\)/g) ?? [];
  assert.equal(matches.length, 2);
  assert.match(auth, /profile\.verified_email !== true/);
});

test("email-method registration: no auto-login into unverified accounts, and the verified email cannot be swapped", () => {
  assert.match(reg, /!existingUser\.emailVerified/);
  assert.match(reg, /email_locked/);
});

test("login/verify bumps attempts atomically, re-checks ban, and consumes the challenge atomically", () => {
  const block = between(auth, 'router.post("/auth/login/verify"', "// ─── ");
  assert.match(block, /attempts\} \+ 1/);
  assert.match(block, /user\.status === "banned"/);
  assert.match(block, /isNull\(loginChallengesTable\.consumedAt\)/);
});

test("single-page signup: complete() refuses without server-side Telegram AND phone verification", () => {
  const block = between(signup, 'router.post("/auth/signup/:id/complete"', "export default router");
  assert.match(block, /!row\.telegramVerifiedAt/);
  assert.match(block, /!row\.phoneVerifiedAt/);
  // ایمیل «تأییدشده» فقط وقتی همان ایمیلِ نهایی تأیید شده
  assert.match(block, /row\.emailVerifiedFor === email/);
});

test("single-page signup: SMS is only sent after Telegram is verified; codes have attempt caps", () => {
  const block = between(signup, 'router.post("/auth/signup/:id/phone/send"', 'router.post("/auth/signup/:id/phone/verify"');
  assert.match(block, /telegram_required/);
  assert.match(signup, /phoneCodeAttempts\} \+ 1/);
  assert.match(signup, /emailCodeAttempts\} \+ 1/);
});

test("Telegram bot confirms signup and carries a return-to-signup button", () => {
  assert.match(hook, /row\.purpose === "signup"/);
  const bot = read("lib/registrationBot.ts");
  assert.match(bot, /sendSignupTelegramVerified/);
  assert.match(bot, /inline_keyboard/);
  assert.match(hook, /\/register\?resume=/);
});

test("telegram unlink requires password re-auth, refuses telegram-2FA / telegram-only accounts", () => {
  const block = between(auth, 'router.post("/auth/telegram/unlink"', "// ─── POST /api/auth/telegram/link/start");
  assert.match(block, /verifyPassword\(password/);
  assert.match(block, /telegram_is_two_factor/);
  assert.match(block, /telegram_only/);
  assert.match(block, /telegramId: null/);
});

test("signup autosave/telegram-link use per-session limits, not the shared per-IP auth bucket", () => {
  const patch = between(signup, 'router.patch("/auth/signup/:id"', 'router.post("/auth/signup/:id/telegram-link"');
  assert.ok(!patch.includes("authRateLimit"), "PATCH must not consume the shared IP bucket");
  assert.match(patch, /withinSessionLimit\(req, res, "patch"/);
  const link = between(signup, 'router.post("/auth/signup/:id/telegram-link"', 'router.post("/auth/signup/:id/phone/send"');
  assert.ok(!link.includes("authRateLimit"));
  assert.match(link, /withinSessionLimit\(req, res, "tglink"/);
});
