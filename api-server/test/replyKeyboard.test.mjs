/**
 * test/replyKeyboard.test.mjs — اعتبارسنجی کیبورد پایین.
 *
 * این تنها قابلیتِ این دور است که **در خودِ بات** هم کد دارد
 * (`handlers/user.py::_reply_keyboard`)، و شکل داده تنها قراردادِ بین آن دو
 * است. اگر سرور چیزی ذخیره کند که بات نتواند بخواند، هیچ خطایی رخ نمی‌دهد —
 * فقط کیبورد ظاهر نمی‌شود. برای همین شکل خروجی اینجا قفل می‌شود.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";

const { __testables } = await import("../src/routes/botSettings.ts");
const { validateReplyKeyboard } = __testables;

test("شکل ذخیره‌شده همانی است که بات می‌خواند", () => {
  const out = validateReplyKeyboard({
    rows: [["/shop", "/support"], ["/help"]],
    resize: true,
    one_time: false,
    placeholder: "یک گزینه را انتخاب کنید",
  });
  assert.deepEqual(out, {
    rows: [["/shop", "/support"], ["/help"]],
    resize: true,
    one_time: false,
    placeholder: "یک گزینه را انتخاب کنید",
  });
});

test("ردیف خالی و دکمه‌ی بی‌متن دور ریخته می‌شوند، نه اینکه خطا بدهند", () => {
  // کاربری که یک ردیف اضافه کرده و هنوز پرش نکرده، نباید ذخیره‌اش رد شود.
  const out = validateReplyKeyboard({ rows: [["/a", "", "  "], [], [""], ["/b"]] });
  assert.deepEqual(out.rows, [["/a"], ["/b"]]);
});

test("کیبورد بدون هیچ دکمه‌ای null می‌شود، نه یک کیبورد خالی", () => {
  // بات روی `null` هیچ کیبوردی نمی‌فرستد؛ یک آبجکت با rows خالی باعث
  // ReplyKeyboardMarkup بی‌دکمه می‌شد که تلگرام ردش می‌کند.
  assert.equal(validateReplyKeyboard({ rows: [] }), null);
  assert.equal(validateReplyKeyboard({ rows: [[""], []] }), null);
  assert.equal(validateReplyKeyboard(null), null);
  assert.equal(validateReplyKeyboard(""), null);
});

test("resize پیش‌فرض روشن است، one_time پیش‌فرض خاموش", () => {
  const out = validateReplyKeyboard({ rows: [["/a"]] });
  assert.equal(out.resize, true, "کیبوردِ تمام‌صفحه پیش‌فرض بدی است");
  assert.equal(out.one_time, false);
  assert.equal(out.placeholder, "");
});

test("سقف ردیف و سقف دکمه در هر ردیف اعمال می‌شوند", () => {
  assert.throws(
    () => validateReplyKeyboard({ rows: Array.from({ length: 11 }, () => ["/x"]) }),
    /ردیف/,
  );
  assert.throws(() => validateReplyKeyboard({ rows: [["a", "b", "c", "d", "e"]] }), /دکمه/);
  // دقیقاً روی سقف باید مجاز باشد.
  assert.equal(validateReplyKeyboard({ rows: [["a", "b", "c", "d"]] }).rows[0].length, 4);
});

test("متن دکمه به ۶۴ کاراکتر بریده می‌شود", () => {
  const out = validateReplyKeyboard({ rows: [["x".repeat(200)]] });
  assert.equal(out.rows[0][0].length, 64);
});

test("ساختار نامعتبر رد می‌شود", () => {
  assert.throws(() => validateReplyKeyboard("چرت"), /معتبر نیست/);
  assert.throws(() => validateReplyKeyboard([1, 2]), /معتبر نیست/);
  // `rows` غیرآرایه یعنی هیچ ردیفی — نه خطا، چون ممکن است از یک نسخه‌ی قدیمی بیاید.
  assert.equal(validateReplyKeyboard({ rows: "nope" }), null);
});
