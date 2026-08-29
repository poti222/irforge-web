/**
 * test/smsOtpRoutes.test.mjs — IRFORGE_SMS_OTP_PROMPT Phase 4
 *
 * روت‌های /auth/otp/sms/send و /auth/otp/sms/verify یک تراکنش دیتابیس واقعی
 * لازم دارند و در این مخزن هیچ زیرساخت تست یکپارچه (سرور واقعی + دیتابیس
 * تست) وجود ندارد — همان الگویی که test/registrationEmailFlow.test.mjs هم
 * دنبال می‌کند: قراردادهای امنیتی/صحت روی متنِ منبع بررسی می‌شوند، نه با
 * اجرای واقعی روت.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../src/routes/auth.ts"), "utf8");

const sendBlock = src.slice(
  src.indexOf('"/auth/otp/sms/send"'),
  src.indexOf('"/auth/otp/sms/verify"'),
);
const verifyBlock = src.slice(src.indexOf('"/auth/otp/sms/verify"'));

test("/auth/otp/sms/send از smsOtpSendRateLimit استفاده می‌کند (فاز ۳، نه authRateLimit ساده)", () => {
  assert.match(src, /router\.post\(\s*["']\/auth\/otp\/sms\/send["']\s*,\s*smsOtpSendRateLimit\(\)/);
});

test("/auth/otp/sms/verify پشتِ authRateLimit است", () => {
  assert.match(src, /router\.post\(\s*["']\/auth\/otp\/sms\/verify["']\s*,\s*authRateLimit\(/);
});

test("send: هدفِ نامعتبر و شماره‌ی نامعتبر قبل از هر کارِ دیگری رد می‌شوند", () => {
  assert.match(sendBlock, /isSmsOtpPurpose\(purpose\)/);
  assert.match(sendBlock, /invalid_purpose/);
  assert.match(sendBlock, /normalizePhone\(req\.body\?\.phone\)/);
  assert.match(sendBlock, /invalid_phone/);
});

test("send: purpose=register شماره‌ی تکراری را صریح رد می‌کند (نه پیامِ ژنریک)", () => {
  const registerGuard = sendBlock.match(/purpose === "register"[\s\S]{0,500}?phone_already_registered/);
  assert.ok(registerGuard, "باید یک شاخه‌ی purpose === register قبل از phone_already_registered باشد");
});

test("send: purpose=login/password_reset روی شماره‌ی ناموجود یا بن‌شده پاسخِ یکسانِ موفقیت می‌دهد (ضدِّشمارش)", () => {
  const guard = sendBlock.match(/!existingUser \|\|\s*existingUser\.status === "banned" \|\|\s*existingUser\.status === "suspended"/);
  assert.ok(guard, "چک نبودِ کاربر و وضعیتِ بن/تعلیق باید با هم یک شاخه باشند");
  const branch = sendBlock.slice(sendBlock.search(/!existingUser \|\|/));
  assert.match(branch.slice(0, 400), /SMS_OTP_SENT_MESSAGE/);
  // این شاخه نباید insert یا sendOtpSms صدا بزند — قبل از رسیدن به آن‌ها return می‌کند.
  const insertIdx = sendBlock.indexOf("db.insert(smsOtpCodesTable)");
  const branchIdx = sendBlock.search(/!existingUser \|\|/);
  assert.ok(insertIdx > branchIdx, "insert باید بعد از شاخه‌ی ضدِّشمارش بیاید تا برای شماره‌ی ناموجود اجرا نشود");
});

test("send: کد قبل از sendOtpSms هش‌شده در دیتابیس ذخیره می‌شود، نه خام", () => {
  const insertBlock = sendBlock.slice(sendBlock.indexOf("db.insert(smsOtpCodesTable)"));
  assert.match(insertBlock, /codeHash:\s*hashCode\(code\)/);
  assert.doesNotMatch(insertBlock.slice(0, insertBlock.indexOf("sendOtpSms") === -1 ? insertBlock.length : insertBlock.indexOf("sendOtpSms")), /codeHash:\s*code[,\s)]/);
});

test("send: کدِ خام هرگز مستقیماً در پاسخِ JSON نیست، مگر پشتِ devEchoCode", () => {
  // اسپرد `...devEchoCode(code)` تنها راهِ مجازِ رسیدنِ کد به پاسخ است.
  assert.match(sendBlock, /\.\.\.devEchoCode\(code\)/);
  assert.doesNotMatch(sendBlock, /res\.json\(\{[^}]*\bcode(?!Hash)\b\s*[,:]/);
});

test("send: خطای sendOtpSms جزئیاتِ خامِ provider را به فرانت برنمی‌گرداند", () => {
  const failIdx = sendBlock.indexOf("if (!sendResult.success)");
  const failBlock = sendBlock.slice(failIdx, failIdx + 500);
  const jsonCall = failBlock.slice(failBlock.indexOf("res.status(502)"), failBlock.indexOf("return;"));
  assert.doesNotMatch(jsonCall, /sendResult\.error/);
  assert.match(jsonCall, /sms_send_failed/);
  // خودِ خطای خام فقط برای لاگ استفاده می‌شود، نه پاسخ.
  assert.match(failBlock, /logger\.warn\([^)]*sendResult\.error/);
});

test("verify: purpose و phone هر دو قبل از خواندنِ sms_otp_codes اعتبارسنجی می‌شوند", () => {
  const purposeIdx = verifyBlock.indexOf("isSmsOtpPurpose(purpose)");
  const phoneIdx = verifyBlock.indexOf("normalizePhone(req.body?.phone)");
  const selectIdx = verifyBlock.indexOf("db\n      .select()\n      .from(smsOtpCodesTable)");
  assert.ok(purposeIdx >= 0 && phoneIdx >= 0 && selectIdx >= 0);
  assert.ok(purposeIdx < selectIdx && phoneIdx < selectIdx);
});

test("verify: فقط ردیفِ مصرف‌نشده و بر اساسِ جدیدترین created_at خوانده می‌شود", () => {
  assert.match(verifyBlock, /isNull\(smsOtpCodesTable\.consumedAt\)/);
  assert.match(verifyBlock, /orderBy\(desc\(smsOtpCodesTable\.createdAt\)\)/);
});

test("verify: شمارنده‌ی attempts قبل از مقایسه‌ی کد بالا می‌رود (بدون تلاشِ رایگان)", () => {
  const attemptsIdx = verifyBlock.indexOf("const attempts = row.attempts + 1;");
  const compareIdx = verifyBlock.indexOf("verifyOtp(String(req.body?.code");
  assert.ok(attemptsIdx >= 0 && compareIdx >= 0 && attemptsIdx < compareIdx);
});

test("verify: بعد از MAX_CODE_ATTEMPTS رکورد consumed می‌شود (کد کشته می‌شود)", () => {
  const guard = verifyBlock.match(/attempts > MAX_CODE_ATTEMPTS[\s\S]{0,200}?consumedAt: new Date\(\)/);
  assert.ok(guard, "باید بعد از عبور از MAX_CODE_ATTEMPTS رکورد را consumed کند");
});

test("verify: مصرفِ کد اتمیک است (شرطِ consumedAt IS NULL داخلِ همان UPDATE)", () => {
  const consumeBlock = verifyBlock.slice(verifyBlock.indexOf("const consumed = await db"));
  const updateCall = consumeBlock.slice(0, consumeBlock.indexOf(".returning("));
  assert.match(updateCall, /isNull\(smsOtpCodesTable\.consumedAt\)/);
  assert.match(consumeBlock.slice(0, 300), /consumed\.length === 0/);
});

test("verify: purpose=register نشست صادر نمی‌کند، فقط verified:true", () => {
  const registerBlock = verifyBlock.match(/purpose === "register"\) \{[\s\S]{0,200}?\}/);
  assert.ok(registerBlock);
  assert.match(registerBlock[0], /verified:\s*true/);
  assert.doesNotMatch(registerBlock[0], /issueSession/);
});

test("verify: purpose=login نشستِ کامل با issueSession صادر می‌کند", () => {
  const loginIdx = verifyBlock.indexOf('purpose === "login") {');
  assert.ok(loginIdx >= 0);
  const loginBlock = verifyBlock.slice(loginIdx, loginIdx + 200);
  assert.match(loginBlock, /issueSession\(user, req\)/);
});

test("verify: purpose=password_reset نشست نمی‌سازد؛ resetToken روی همان resetCodeHash/usersTable می‌نویسد", () => {
  const loginIdx = verifyBlock.indexOf('purpose === "login") {');
  const loginBlockEnd = verifyBlock.indexOf("}", verifyBlock.indexOf("issueSession", loginIdx)) + 1;
  const resetBlock = verifyBlock.slice(loginBlockEnd);
  assert.doesNotMatch(resetBlock, /issueSession/);
  assert.match(resetBlock, /resetCodeHash:\s*hashCode\(resetToken\)/);
  assert.match(resetBlock, /resetCodeExpiresAt:/);
});

test("verify: برای login/password_reset حسابِ بن‌شده یا حذف‌شده همان پیامِ «منقضی شده» می‌گیرد", () => {
  const guard = verifyBlock.match(/!user \|\| user\.status === "banned" \|\| user\.status === "suspended"/);
  assert.ok(guard, "باید بعد از یافتنِ userId، وضعیتِ حساب هم چک شود");
});

test("verify: تأییدِ موفقِ login/password_reset، phoneVerified کاربر را true می‌کند", () => {
  assert.match(verifyBlock, /if \(!user\.phoneVerified\)[\s\S]{0,150}?phoneVerified:\s*true/);
});
