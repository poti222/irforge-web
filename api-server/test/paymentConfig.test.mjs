/**
 * test/paymentConfig.test.mjs — اعتبارسنجی و merge برای `payment_cfg`.
 * IRFORGE_PAYMENT_SETTINGS_WEB_PROMPT، فاز B7.
 *
 * قراردادِ این فایل با بات مشترک است: شکلِ ۸ فیلدِ اول (منبعِ حقیقت
 * `irforge-app/handlers/payment.py:34-60`) باید مو‌به‌مو یکی بماند، وگرنه
 * سایت و بات دو چیز متفاوت به ادمین نشان می‌دهند. فیلدهای خارج از دامنه
 * (`buy_buttons` و مشابه) باید از این ولیدیشن دست‌نخورده رد شوند — همان
 * قانونی که برای `working_hours`/`anti_flood` هم برقرار است (باگ B11).
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";

const { __testables } = await import("../src/routes/botSettings.ts");
const { validatePaymentConfig } = __testables;

function currentCfg(overrides = {}) {
  return {
    card_enabled: false,
    card_number: "",
    card_owner: "",
    gateway_enabled: false,
    gateway_url: "",
    gateway_label: "💳 پرداخت آنلاین",
    order_group: "",
    verify_required: true,
    ...overrides,
  };
}

// ─── شماره کارت ──────────────────────────────────────────────────────────────

test("شماره کارت ۱۶ رقمی پذیرفته می‌شود", () => {
  const out = validatePaymentConfig({ card_number: "6037991234567890" }, currentCfg());
  assert.equal(out.card_number, "6037991234567890");
});

test("شماره کارت ۱۹ رقمی پذیرفته می‌شود", () => {
  const out = validatePaymentConfig({ card_number: "6037991234567890123" }, currentCfg());
  assert.equal(out.card_number, "6037991234567890123");
});

test("شماره کارت ۱۵ رقمی رد می‌شود", () => {
  assert.throws(
    () => validatePaymentConfig({ card_number: "123456789012345" }, currentCfg()),
    /۱۶ یا ۱۹/,
  );
});

test("فاصله و خط‌تیره از شماره کارت پاک می‌شود", () => {
  const out = validatePaymentConfig({ card_number: "6037-9912 3456 7890" }, currentCfg());
  assert.equal(out.card_number, "6037991234567890");
});

test("شماره کارت خالی مجاز است", () => {
  const out = validatePaymentConfig({ card_number: "" }, currentCfg());
  assert.equal(out.card_number, "");
});

test("شماره کارت غیرعددی رد می‌شود", () => {
  assert.throws(() => validatePaymentConfig({ card_number: "6037abcd1234567" }, currentCfg()), /رقم/);
});

// ─── قانونِ سازگاری: کارتِ روشن + شماره‌ی خالی ──────────────────────────────

test("card_enabled=true با شماره‌ی خالی رد می‌شود", () => {
  assert.throws(
    () => validatePaymentConfig({ card_enabled: true, card_number: "" }, currentCfg()),
    /شماره کارت را وارد کنید/,
  );
});

test("card_enabled=true با شماره‌ی موجودِ فعلی (بدون فرستادنِ شماره‌ی تازه) رد نمی‌شود", () => {
  const out = validatePaymentConfig(
    { card_enabled: true },
    currentCfg({ card_number: "6037991234567890" }),
  );
  assert.equal(out.card_enabled, true);
  assert.equal(out.card_number, "6037991234567890");
});

// ─── آدرس درگاه ──────────────────────────────────────────────────────────────

test("gateway_url با http رد می‌شود", () => {
  assert.throws(
    () => validatePaymentConfig({ gateway_url: "http://example.com/pay" }, currentCfg()),
    /https/,
  );
});

test("gateway_url با https پذیرفته می‌شود", () => {
  const out = validatePaymentConfig({ gateway_url: "https://example.com/pay" }, currentCfg());
  assert.equal(out.gateway_url, "https://example.com/pay");
});

test("gateway_url خالی مجاز است", () => {
  const out = validatePaymentConfig({ gateway_url: "" }, currentCfg());
  assert.equal(out.gateway_url, "");
});

test("gateway_url نامعتبر (نه یک URL) رد می‌شود", () => {
  assert.throws(() => validatePaymentConfig({ gateway_url: "not a url" }, currentCfg()), /معتبر نیست/);
});

// ─── بقیه‌ی فیلدها ───────────────────────────────────────────────────────────

test("gateway_label خالی به پیش‌فرض برمی‌گردد", () => {
  const out = validatePaymentConfig({ gateway_label: "" }, currentCfg());
  assert.equal(out.gateway_label, "💳 پرداخت آنلاین");
});

test("gateway_label به ۶۴ کاراکتر بریده می‌شود", () => {
  const out = validatePaymentConfig({ gateway_label: "x".repeat(200) }, currentCfg());
  assert.equal(out.gateway_label.length, 64);
});

test("card_owner به ۱۰۰ کاراکتر بریده و trim می‌شود", () => {
  const out = validatePaymentConfig({ card_owner: `  ${"a".repeat(200)}  ` }, currentCfg());
  assert.equal(out.card_owner.length, 100);
});

test("order_group خالی مجاز است", () => {
  const out = validatePaymentConfig({ order_group: "" }, currentCfg());
  assert.equal(out.order_group, "");
});

test("order_group با - یا رقم شروع می‌شود، وگرنه رد می‌شود", () => {
  assert.equal(validatePaymentConfig({ order_group: "-1001234567890" }, currentCfg()).order_group, "-1001234567890");
  assert.throws(() => validatePaymentConfig({ order_group: "abc" }, currentCfg()), /گروه سفارش/);
});

test("بولین‌ها با Boolean() تبدیل می‌شوند", () => {
  const out = validatePaymentConfig({ gateway_enabled: 1, verify_required: 0 }, currentCfg());
  assert.equal(out.gateway_enabled, true);
  assert.equal(out.verify_required, false);
});

// ─── merge با فیلدهای خارج از دامنه (باگ B11) ────────────────────────────────

test("فیلد خارج از دامنه (buy_buttons) در خروجی دست‌نخورده باقی می‌ماند", () => {
  const current = currentCfg({ buy_buttons: [{ text: "خرید", url: "https://x" }], receipt_dedup_enabled: true });
  const out = validatePaymentConfig({ card_owner: "علی" }, current);
  assert.deepEqual(out.buy_buttons, [{ text: "خرید", url: "https://x" }]);
  assert.equal(out.receipt_dedup_enabled, true);
  assert.equal(out.card_owner, "علی");
});

test("بدنه‌ی خالی همه‌چیز را از current می‌گیرد", () => {
  const current = currentCfg({ card_enabled: true, card_number: "6037991234567890" });
  const out = validatePaymentConfig({}, current);
  assert.deepEqual(out, current);
});

test("بدنه‌ی نامعتبر رد می‌شود", () => {
  assert.throws(() => validatePaymentConfig(null, currentCfg()), /معتبر نیست/);
  assert.throws(() => validatePaymentConfig("x", currentCfg()), /معتبر نیست/);
});
