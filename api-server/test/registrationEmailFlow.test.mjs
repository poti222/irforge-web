/**
 * test/registrationEmailFlow.test.mjs — IRFORGE_PROMPT_V3 Phase 14
 *
 * روت‌های ثبت‌نام یک تراکنش دیتابیس واقعی لازم دارند و در این مخزن هیچ
 * زیرساخت تست یکپارچه (سرور واقعی + دیتابیس تست) وجود ندارد — همان الگویی
 * که test/adminPanel.test.mjs هم دنبال می‌کند: قراردادهای امنیتی/صحت روی
 * متنِ منبع بررسی می‌شوند، نه با اجرای واقعی روت.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../src/routes/registration.ts"), "utf8");
const authSrc = readFileSync(join(here, "../src/routes/auth.ts"), "utf8");

test("یک اندپوینت جدا برای شروع ثبت‌نام با ایمیل وجود دارد، با محدودسازی نرخ", () => {
  assert.match(src, /router\.post\(\s*["']\/auth\/register\/email\/start["']\s*,\s*authRateLimit/);
});

test("resend: ردیف‌های ایمیل نباید نبودِ telegramChatId را «تلگرام وصل نیست» بشمارند", () => {
  const guard = src.match(/const isEmailMethod = row\.registrationMethod === "email";[\s\S]{0,200}?no_telegram/);
  assert.ok(guard, "باید یک isEmailMethod قبل از بررسیِ no_telegram در resend باشد");
  assert.match(guard[0], /!isEmailMethod && !row\.telegramChatId/);
});

test("resend: ردیف‌های ایمیل کد را با sendEmailRegistrationCode می‌فرستند، نه sendRegistrationCode", () => {
  const resendBlock = src.slice(src.indexOf('"/auth/register/resend"'));
  assert.match(resendBlock, /if \(isEmailMethod\)[\s\S]{0,100}sendEmailRegistrationCode/);
  assert.match(resendBlock, /else[\s\S]{0,100}sendRegistrationCode/);
});

test("complete: ردیف‌های ایمیل نباید نبودِ phone/telegramId را «تلگرام وصل نیست» بشمارند", () => {
  const completeBlock = src.slice(src.indexOf('"/auth/register/complete"'));
  assert.match(completeBlock, /!isEmailMethod && \(!row\.phone \|\| !row\.telegramId\)/);
});

test("complete: بررسیِ یکتاییِ شماره فقط وقتی اجرا می‌شود که ردیف واقعاً شماره داشته باشد", () => {
  const completeBlock = src.slice(src.indexOf('"/auth/register/complete"'));
  const guarded = completeBlock.match(/if \(row\.phone\) \{[\s\S]{0,300}?phoneTaken/);
  assert.ok(guarded, "phoneTaken باید داخل `if (row.phone)` باشد تا برای ردیف‌های ایمیل (بدون شماره) اجرا نشود");
});

test("complete: phoneVerified فقط برای مسیر شماره‌ای true می‌شود، emailVerified فقط برای مسیر ایمیلی", () => {
  const completeBlock = src.slice(src.indexOf('"/auth/register/complete"'));
  assert.match(completeBlock, /phoneVerified:\s*Boolean\(row\.phone\)\s*&&\s*!isEmailMethod/);
  assert.match(completeBlock, /emailVerified:\s*isEmailMethod/);
});

test("پاسخ نهاییِ complete وضعیتِ emailVerified کاربر را هم برمی‌گرداند", () => {
  // پاسخ دیگر آبجکتِ inline نیست — از toAuthUser() در routes/auth.ts می‌آید
  // (مشترک بین همه‌ی روت‌های ورود/ثبت‌نام)، پس این چک آنجا انجام می‌شود.
  const toAuthUserBlock = authSrc.slice(
    authSrc.indexOf("export function toAuthUser"),
    authSrc.indexOf("function generateToken"),
  );
  assert.match(toAuthUserBlock, /emailVerified:\s*user\.emailVerified/);
});
