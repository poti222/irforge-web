/**
 * test/sheetValueRoundTrip.test.mjs — رفت‌وبرگشتِ مقدار روی شیت.
 *
 * ریشه‌ی مشترکِ چهار باگ گزارش‌شده اینجا بود، و چون هیچ‌کدام خطا نمی‌دادند
 * (فقط رفتار اشتباه می‌شد) هیچ لاگی هم نداشتند:
 *
 *   - پیام خوش‌آمد خاموش نمی‌شد
 *   - حالت تعمیر درست عمل نمی‌کرد
 *   - ذخیره‌ی تنظیمات با «مقدار watermark_enabled باید true یا false باشد»
 *     رد می‌شد، بدون اینکه کاربر آن فیلد را لمس کرده باشد
 *
 * علت: سایت با `valueInputOption: USER_ENTERED` می‌نوشت. با آن حالت گوگل
 * رشته‌ی `false` را به یک سلول **بولی واقعی** تبدیل می‌کند، و همان سلول موقع
 * خواندن `FALSE` برمی‌گردد — که JSON معتبر نیست. در پایتون
 * `bool("FALSE")` برابر `True` است، پس هر تنظیمِ خاموش‌شده روشن اجرا می‌شد.
 *
 * این فایل هر دو نیمه‌ی اصلاح را قفل می‌کند: نوشتن `RAW` باشد، و خواندن
 * سلول‌های خرابِ موجود را ترمیم کند.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const sheetsSrc = readFileSync(join(here, "../src/lib/sheets.ts"), "utf8");

test("نوشتن روی شیت هرگز USER_ENTERED نیست", () => {
  // به‌جای جست‌وجوی خودِ کلمه (که در توضیحات هم می‌آید)، دنبال **استفاده**اش
  // می‌گردیم: هر مقداری که به `valueInputOption` داده می‌شود.
  const assigned = [...sheetsSrc.matchAll(/valueInputOption:\s*([^,\n]+)/g)]
    .map((m) => m[1].trim());
  assert.deepEqual(
    assigned,
    ["VALUE_INPUT_OPTION", "VALUE_INPUT_OPTION"],
    "هر دو مسیر نوشتن باید از همان ثابت استفاده کنند، نه رشته‌ی درجا",
  );
  assert.match(sheetsSrc, /const VALUE_INPUT_OPTION = "RAW"/);
});

test("سلول بولیِ خرابِ گوگل موقع خواندن ترمیم می‌شود", async () => {
  const { __testables } = await import("../src/lib/tenantSheets.ts");
  const { parseCell } = __testables;

  // همان چیزی که یک شیتِ خراب‌شده برمی‌گرداند
  assert.equal(parseCell("TRUE").value, true);
  assert.equal(parseCell("FALSE").value, false);
  assert.equal(parseCell("FALSE").raw, false, "ترمیم‌شده دیگر «متن خام» نیست");

  // JSON سالم دست‌نخورده می‌ماند
  assert.equal(parseCell("true").value, true);
  assert.equal(parseCell("false").value, false);
  assert.equal(parseCell("123").value, 123);
  assert.deepEqual(parseCell('{"a":1}').value, { a: 1 });

  // و چیزی که می‌تواند داده‌ی واقعی کاربر باشد به بولی تبدیل نمی‌شود.
  // (`"1"`/`"0"` خودشان JSON معتبرند و **عدد** می‌شوند — نه بولی، که مهم است.
  // `"false "` هم JSON معتبر است چون JSON.parse فاصله‌ی انتهایی را می‌پذیرد.)
  for (const raw of ["1", "0", "yes", "no", "True", "سلام", "TRUEISH", "FALSEY"]) {
    assert.notEqual(typeof parseCell(raw).value, "boolean", `${raw} نباید بولی شود`);
  }
  // ترمیم حساس به حروف بزرگ/کوچک است: فقط دقیقاً TRUE/FALSE.
  assert.equal(typeof parseCell("True").value, "string");
  assert.equal(typeof parseCell("FALSEY").value, "string");
});
