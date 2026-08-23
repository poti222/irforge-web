/**
 * test/loginEmailFlow.test.mjs — IRFORGE_PROMPT_V3 Phase 14
 *
 * /auth/login یک تراکنش/کوئری واقعیِ دیتابیس لازم دارد و این مخزن زیرساخت
 * تست یکپارچه ندارد (همان محدودیتِ test/registrationEmailFlow.test.mjs) —
 * پس قراردادهای امنیتی روی متنِ منبع بررسی می‌شوند.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../src/routes/auth.ts"), "utf8");
const loginBlock = src.slice(src.indexOf('router.post("/auth/login",'), src.indexOf('router.post("/auth/login/verify"'));

test("ورود ایمیل را فقط وقتی می‌پذیرد که شماره نیامده باشد (شماره برتری دارد)", () => {
  assert.match(loginBlock, /const email = !phone && req\.body\?\.email/);
});

test("حساب فقط-ایمیل بدون شماره و بدون تلگرام مشخص است، نه با یک شرط دیگر", () => {
  assert.match(loginBlock, /const isEmailOnlyAccount = !user\.telegramId && !user\.phone;/);
});

test("حساب قدیمیِ شماره‌محورِ بدون تلگرام هنوز باید «تلگرام لازم است» ببیند", () => {
  const guard = loginBlock.match(/if \(!user\.telegramId && !isEmailOnlyAccount\) \{[\s\S]{0,900}?telegram_required/);
  assert.ok(guard, "شرط ورود به بلاکِ telegram_required باید isEmailOnlyAccount را هم در نظر بگیرد");
});

test("حساب فقط-ایمیل کدش را با sendEmailLoginCode می‌گیرد، نه sendLoginCode", () => {
  assert.match(loginBlock, /if \(isEmailOnlyAccount\)[\s\S]{0,60}sendEmailLoginCode\(user\.email/);
  assert.match(loginBlock, /\} else \{[\s\S]{0,60}sendLoginCode\(user\.telegramId/);
});

test("محدودسازی نرخ برای ورود با ایمیل از emailKey استفاده می‌کند، نه از phoneKey با ایمیل", () => {
  assert.match(loginBlock, /const rateKey = phone \? phoneKey\(phone\) : emailKey\(email as string\);/);
});

test("پاسخِ شکستِ عمومی مستقل از این‌که شناسه شماره بود یا ایمیل، یکسان است", () => {
  assert.match(loginBlock, /\(!phone && !email\) \|\| typeof password !== "string"/);
  // genericFail خودش را با هر دو مسیر صدا می‌زند — فقط یک نسخه از پیام باید باشد
  const genericFailOccurrences = (loginBlock.match(/genericFail\(\)/g) ?? []).length;
  assert.ok(genericFailOccurrences >= 2, "هم نبودِ شناسه و هم رمز غلط باید از همان genericFail عبور کنند");
});
