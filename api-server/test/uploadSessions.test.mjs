/**
 * test/uploadSessions.test.mjs — استخراج محتوا از پیام تلگرام.
 *
 * چرخه‌ی کامل جلسه (ساخت → waiting → filled) به دیتابیس نیاز دارد و روی یک
 * Postgres واقعی دستی راستی‌آزمایی شده (نگاه کنید به PROGRESS.md). آنچه اینجا
 * تست می‌شود، تابع خالصی است که تصمیم می‌گیرد از یک آپدیت تلگرام **چه چیزی**
 * برداشته شود — و همان جایی است که یک اشتباه، بی‌صدا محتوای غلط می‌فرستد:
 * عکس با کیفیت بندانگشتی، ویسی که به‌عنوان سند فرستاده می‌شود، یا متنی که
 * فرمتش را از دست داده.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";

const { extractContent } = await import("../src/lib/uploadSessions.ts");

test("عکس: بزرگ‌ترین اندازه انتخاب می‌شود، نه اولی", () => {
  // تلگرام آرایه را از کوچک به بزرگ می‌دهد؛ برداشتن [0] یعنی فرستادن
  // بندانگشتی به همه‌ی کاربران.
  const out = extractContent({
    message_id: 1,
    photo: [{ file_id: "thumb" }, { file_id: "mid" }, { file_id: "full" }],
    caption: "توضیح",
    caption_entities: [{ type: "bold", offset: 0, length: 5 }],
  });
  assert.equal(out.mediaType, "photo");
  assert.equal(out.fileId, "full");
  assert.equal(out.content, "توضیح");
  assert.equal(out.entities.length, 1);
});

test("متن با entities حفظ می‌شود", () => {
  const out = extractContent({
    message_id: 2,
    text: "سلام دنیا",
    entities: [{ type: "bold", offset: 0, length: 4 }],
  });
  assert.equal(out.mediaType, "text");
  assert.equal(out.fileId, null);
  assert.equal(out.content, "سلام دنیا");
  assert.equal(out.entities[0].type, "bold");
});

test("ویس و صوت از هم تفکیک می‌شوند", () => {
  assert.equal(extractContent({ message_id: 3, voice: { file_id: "v" } }).mediaType, "voice");
  assert.equal(extractContent({ message_id: 4, audio: { file_id: "a" } }).mediaType, "audio");
});

test("ویدیو، فایل و گیف هم شناخته می‌شوند", () => {
  assert.equal(extractContent({ message_id: 5, video: { file_id: "x" } }).mediaType, "video");
  assert.equal(extractContent({ message_id: 6, document: { file_id: "x" } }).mediaType, "document");
  assert.equal(extractContent({ message_id: 7, animation: { file_id: "x" } }).mediaType, "animation");
});

test("مدیا بر متن اولویت دارد", () => {
  // یک عکس با کپشن هم `photo` دارد هم `caption`؛ اگر متن برنده شود، عکس گم
  // می‌شود و کاربران فقط کپشن را می‌گیرند.
  const out = extractContent({ message_id: 8, photo: [{ file_id: "p" }], caption: "کپشن" });
  assert.equal(out.mediaType, "photo");
  assert.equal(out.content, "کپشن");
});

test("نوع پشتیبانی‌نشده و پیام خالی رد می‌شوند، نه اینکه خالی ضبط شوند", () => {
  assert.equal(extractContent({ message_id: 9, sticker: { file_id: "s" } }), null);
  assert.equal(extractContent({ message_id: 10, poll: { id: "1" } }), null);
  assert.equal(extractContent({ message_id: 11 }), null);
  assert.equal(extractContent({ message_id: 12, text: "" }), null);
  assert.equal(extractContent(null), null);
});

test("پیام بدون message_id رد می‌شود", () => {
  // بدون شناسه‌ی پیام نمی‌شود به آن ارجاع داد؛ ضبطش یعنی یک ردیف بی‌مصرف.
  assert.equal(extractContent({ text: "سلام" }), null);
});

test("مدیای بدون file_id به متن سقوط می‌کند، نه به مدیای شکسته", () => {
  const out = extractContent({ message_id: 13, photo: [{}], text: "پشتیبان" });
  assert.equal(out.mediaType, "text");
  assert.equal(out.content, "پشتیبان");
});
