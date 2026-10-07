/**
 * test/updateTeaser.test.mjs — پیامِ «آپدیت سایت» در تلگرام: پاراگرافِ اول + دکمه‌ی قرمزِ داشبورد.
 * (قبلاً ۵۰۰ نویسه‌ی اولِ متن وسطِ جمله بریده می‌شد.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const { updateTeaser, UPDATE_TEASER_MAX } = await import("../src/lib/updateTeaser.ts");
const { renderMessage, telegramKeyboard } = await import("../src/lib/notifyTelegram.ts");

test("teaser: متنِ کوتاهِ تک‌پاراگرافی کامل می‌آید و truncated نیست", () => {
  assert.deepEqual(updateTeaser("ظاهر سایت تازه شد."), { text: "ظاهر سایت تازه شد.", truncated: false });
});

test("teaser: فقط پاراگرافِ اول؛ بقیه truncated=true", () => {
  const t = updateTeaser("خلاصه‌ی آپدیت.\n\n- مورد یک\n- مورد دو");
  assert.equal(t.text, "خلاصه‌ی آپدیت.");
  assert.equal(t.truncated, true);
});

test("teaser: پاراگرافِ بلند در پایانِ جمله بریده می‌شود، نه وسطِ کلمه/جمله", () => {
  const sentence = "این یک جمله‌ی نسبتاً بلند برای آزمونِ برش است. ";
  const body = sentence.repeat(30);
  const t = updateTeaser(body);
  assert.ok(Array.from(t.text).length <= UPDATE_TEASER_MAX);
  assert.ok(t.text.endsWith("."), t.text.slice(-20));
  assert.equal(t.truncated, true);
  assert.ok(body.startsWith(t.text));
});

test("teaser: بدونِ پایانِ جمله در آخرین فاصله می‌برد و «…» می‌گذارد", () => {
  const body = "کلمه ".repeat(200).trim();
  const t = updateTeaser(body, 100);
  assert.ok(t.text.endsWith("…"));
  assert.ok(!t.text.slice(0, -1).endsWith(" "));
  assert.ok(Array.from(t.text).length <= 101);
});

test("teaser: ایموجی در مرزِ برش دو نیم نمی‌شود", () => {
  const body = "😀".repeat(500);
  const t = updateTeaser(body, 100);
  assert.doesNotMatch(t.text, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  assert.doesNotMatch(t.text, /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
});

test("teaser: نشانه‌گذاریِ مارک‌داون (# و ** و `) حذف می‌شود", () => {
  assert.equal(updateTeaser("# عنوان\n\nمتن").text, "عنوان");
  assert.equal(updateTeaser("**مهم** است `کد`").text, "مهم است کد");
});

test("teaser: ورودیِ خالی/نامعتبر", () => {
  assert.deepEqual(updateTeaser(""), { text: "", truncated: false });
  assert.deepEqual(updateTeaser(undefined), { text: "", truncated: false });
});

const input = {
  type: "site_update", severity: "info", title: "بازطراحی", message: "x".repeat(500), refId: "u1",
  telegram: {
    message: "فقط پاراگرافِ اول.",
    button: { text: "مشاهده‌ی آپدیت کامل از سایت", path: "/dashboard", style: "danger" },
  },
};

test("renderMessage: متنِ تلگرام جایگزینِ message می‌شود (و escape می‌شود)", () => {
  const text = renderMessage({ ...input, telegram: { ...input.telegram, message: "a < b & c" } });
  assert.match(text, /<b>بازطراحی<\/b>/);
  assert.match(text, /a &lt; b &amp; c/);
  assert.doesNotMatch(text, /xxxx/);
});

test("renderMessage: بدونِ override همان message می‌آید", () => {
  const { telegram, ...plain } = input;
  assert.match(renderMessage({ ...plain, message: "سلام" }), /سلام/);
});

test("telegramKeyboard: دکمه‌ی قرمزِ داشبورد با url کامل", () => {
  const kb = telegramKeyboard("https://irforge.ir/", input);
  assert.deepEqual(kb, {
    inline_keyboard: [[{ text: "مشاهده‌ی آپدیت کامل از سایت", url: "https://irforge.ir/dashboard", style: "danger" }]],
  });
});

test("telegramKeyboard: مسیرِ بدونِ اسلش هم درست ساخته می‌شود؛ بدونِ override همان «مشاهده در سایت»", () => {
  assert.equal(
    telegramKeyboard("https://irforge.ir", { ...input, telegram: { button: { text: "t", path: "dashboard" } } }).inline_keyboard[0][0].url,
    "https://irforge.ir/dashboard",
  );
  const { telegram, ...plain } = input;
  const kb = telegramKeyboard("https://irforge.ir", plain);
  assert.equal(kb.inline_keyboard[0][0].text, "مشاهده در سایت");
  assert.equal(kb.inline_keyboard[0][0].url, "https://irforge.ir/updates/u1");
  assert.equal("style" in kb.inline_keyboard[0][0], false);
});
