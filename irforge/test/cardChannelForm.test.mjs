/**
 * test/cardChannelForm.test.mjs — منطقِ فرمِ «کارت‌به‌کارت خودکار»: لینک و کارت هر دو اختیاری، حداقل یکی لازم.
 * (قاعده باید با `deriveKind` در api-server/src/lib/paymentChannelAdmin.ts یکی باشد؛ سرور هم دوباره می‌سنجد.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { deriveFormKind, formProblems, willHaveCard } = await import("../src/components/bots/settings/cardChannelForm.ts");

test("deriveFormKind: کارت/لینک/هر دو/هیچ‌کدام", () => {
  assert.equal(deriveFormKind(true, false, "open_link"), "card_manual");
  assert.equal(deriveFormKind(true, false, "fixed_link"), "card_manual");
  assert.equal(deriveFormKind(false, true, "open_link"), "open_link");
  assert.equal(deriveFormKind(false, true, "fixed_link"), "fixed_link");
  assert.equal(deriveFormKind(true, true, "open_link"), "open_link");
  assert.equal(deriveFormKind(true, true, "fixed_link"), "open_link", "لینکِ ثابت با کارت ترکیب نمی‌شود؛ مبلغ‌باز می‌شود");
  assert.equal(deriveFormKind(false, false, "open_link"), null);
});

test("formProblems: حداقل یکی، و نامِ صاحبِ کارت فقط با کارت", () => {
  assert.deepEqual(formProblems({ hasCard: false, hasUrl: false, holderName: "" }), ["need_one"]);
  assert.deepEqual(formProblems({ hasCard: false, hasUrl: true, holderName: "" }), [], "فقط لینک: نامِ صاحبِ کارت لازم نیست");
  assert.deepEqual(formProblems({ hasCard: true, hasUrl: false, holderName: "  " }), ["holder_required"]);
  assert.deepEqual(formProblems({ hasCard: true, hasUrl: true, holderName: "علی" }), []);
  assert.deepEqual(formProblems({ hasCard: true, hasUrl: false, holderName: "علی" }), []);
});

test("willHaveCard: کارتِ تازه، یا کارتِ فعلی که برداشته نشده", () => {
  assert.equal(willHaveCard({ newCardDigits: "", existingCard: false, removeCard: false }), false);
  assert.equal(willHaveCard({ newCardDigits: "6037997000000001", existingCard: false, removeCard: false }), true);
  assert.equal(willHaveCard({ newCardDigits: "", existingCard: true, removeCard: false }), true, "خالی = همان کارتِ قبلی");
  assert.equal(willHaveCard({ newCardDigits: "", existingCard: true, removeCard: true }), false);
  assert.equal(willHaveCard({ newCardDigits: "6037997000000001", existingCard: true, removeCard: true }), true, "کارتِ تازه جایگزین می‌شود");
});

test("UI از همین منطق استفاده می‌کند: نوعِ کانال انتخاب‌گرِ جدا ندارد، دکمه‌ی ذخیره با مشکل غیرفعال است، کارت و لینک هر دو فیلد دارند", () => {
  const src = fs.readFileSync(new URL("../src/components/bots/settings/CardAutoConfirmSection.tsx", import.meta.url), "utf8");
  assert.match(src, /deriveFormKind\(hasCard, hasUrl, linkType\)/);
  assert.match(src, /disabled=\{pending \|\| problems\.length > 0\}/);
  assert.match(src, /id="cac-url"/);
  assert.match(src, /id="cac-card"/);
  assert.doesNotMatch(src, /\{t\.cardAutoKind\}/, "انتخاب‌گرِ «نوعِ کانال» برداشته شد");
  assert.match(src, /patch\.cardNumber = null/, "برداشتنِ کارت با null");
});
