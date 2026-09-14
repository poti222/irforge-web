/**
 * test/panelContactEntries.test.mjs — IRFORGE_BOOKING_FORM_CONTACT_REFERRAL_PROMPT پیگیری.
 *
 * `routes/botPanels.ts::validateContactEntries()` — ولیدیشنِ سمتِ سایتِ نوعِ
 * پنلِ تازه‌ی `contact_info`. آینه‌ی دقیقِ همین قاعده در
 * `handlers/panel_builder.py::fsm_contact_value` (بات) — هر دو باید یک
 * چیز را رد/قبول کنند.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";

const { validateContactEntries } = await import("../src/routes/botPanels.ts");
const { BotConfigError } = await import("../src/lib/botConfig.ts");

function entry(overrides = {}) {
  return { kind: "phone", label: "شماره فروش", value: "+98912xxxxxxx", ...overrides };
}

test("یک مورد معتبر با هر ۴ فیلد برمی‌گردد", () => {
  const out = validateContactEntries([entry({ id: "ce1" })]);
  assert.deepEqual(out, [{ id: "ce1", kind: "phone", label: "شماره فروش", value: "+98912xxxxxxx" }]);
});

test("id نبود؟ خودکار ساخته می‌شود", () => {
  const out = validateContactEntries([entry()]);
  assert.equal(out[0].id, "ce1");
});

test("آرایه نبودن ورودی رد می‌شود", () => {
  assert.throws(() => validateContactEntries({}), BotConfigError);
});

test("بیش از حداکثر مورد رد می‌شود", () => {
  const many = Array.from({ length: 21 }, () => entry());
  assert.throws(() => validateContactEntries(many), BotConfigError);
});

test("دقیقاً سقف (۲۰ مورد) قبول می‌شود", () => {
  const twenty = Array.from({ length: 20 }, () => entry());
  const out = validateContactEntries(twenty);
  assert.equal(out.length, 20);
});

test("نوعِ ناشناخته رد می‌شود", () => {
  assert.throws(() => validateContactEntries([entry({ kind: "fax" })]), BotConfigError);
});

test("برچسبِ خالی رد می‌شود", () => {
  assert.throws(() => validateContactEntries([entry({ label: "  " })]), BotConfigError);
});

test("مقدارِ خالی رد می‌شود", () => {
  assert.throws(() => validateContactEntries([entry({ value: "" })]), BotConfigError);
});

test("برچسبِ بیش از ۸۰ کاراکتر رد می‌شود", () => {
  assert.throws(() => validateContactEntries([entry({ label: "ا".repeat(81) })]), BotConfigError);
});

test("مقدارِ بیش از ۳۰۰ کاراکتر رد می‌شود", () => {
  assert.throws(() => validateContactEntries([entry({ value: "۱".repeat(301) })]), BotConfigError);
});

// ── قاعده‌ی اصلی: فقط «link» باید https:// باشد ─────────────────────────────

test("kind=link با https:// قبول می‌شود", () => {
  const out = validateContactEntries([entry({ kind: "link", value: "https://wa.me/98912xxxxxxx" })]);
  assert.equal(out[0].value, "https://wa.me/98912xxxxxxx");
});

test("kind=link با tel: رد می‌شود — دقیقاً همان درسِ بخشِ ۴", () => {
  assert.throws(
    () => validateContactEntries([entry({ kind: "link", value: "tel:+98912xxxxxxx" })]),
    (err) => err instanceof BotConfigError && err.message.includes("https://"),
  );
});

test("kind=link با http:// ساده (نه https) رد می‌شود", () => {
  assert.throws(() => validateContactEntries([entry({ kind: "link", value: "http://example.com" })]), BotConfigError);
});

test("kind=phone هیچ الزامِ https:// ندارد — هر متنی قبول است", () => {
  const out = validateContactEntries([entry({ kind: "phone", value: "021-12345678" })]);
  assert.equal(out[0].value, "021-12345678");
});

test("kind=address هیچ الزامِ https:// ندارد", () => {
  const out = validateContactEntries([entry({ kind: "address", value: "تهران، خیابان..." })]);
  assert.equal(out[0].kind, "address");
});

test("چند مورد با انواعِ مختلط با هم قبول می‌شوند", () => {
  const out = validateContactEntries([
    entry({ id: "ce1", kind: "phone" }),
    entry({ id: "ce2", kind: "address", value: "تهران" }),
    entry({ id: "ce3", kind: "link", value: "https://t.me/example" }),
  ]);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((e) => e.kind), ["phone", "address", "link"]);
});
