/**
 * test/plugin-text.test.mjs — plugin-text.ts's fa/en text pickers.
 *
 * IRFORGE_PRODUCTS_PHASES_3_TO_6_PROMPT Phase 6: this file previously had no
 * dedicated test at all, even though `pluginName()`/`pluginDescription()`
 * exist specifically to fix the historical `marketplace_items` bug — a
 * single-column field that always got the Persian sync write, so English
 * users silently saw Persian.
 *
 * A real instance of the *same class* of bug was caught during this phase's
 * own testing: `pages/buy-bot.tsx`'s new `CategoryProductGrid` (products
 * section, Phase 3) called `pluginName(product, lang, ...)` directly on a
 * `Product` object, which has camelCase `nameFa`/`descriptionFa` — but
 * `pluginName()` reads snake_case `name_fa`/`description_fa`. Because
 * `PluginTextSource`'s fields are all optional, TypeScript accepted the
 * call with zero error; at runtime `name_fa` was always `undefined`, so a
 * Farsi viewer would have silently seen the English name instead of the
 * Farsi one — the inverse direction of the original marketplace_items bug,
 * same root cause (the two language columns not lining up with what the
 * picker function reads). Fixed by adding camelCase-aware
 * `productName()`/`productDescription()` and switching the one real call
 * site to them; this test file locks both function families down so this
 * exact class of regression — quietly serving the wrong language when the
 * source object's key names don't match what the picker expects — can't
 * come back unnoticed for either shape.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { pluginName, pluginDescription, productName, productDescription } =
  await import("../src/lib/plugin-text.ts");

// ─── pluginName / pluginDescription (snake_case — plugin manifests) ────────

test("pluginName: زبانِ fa، name_fa را برمی‌گرداند", () => {
  assert.equal(pluginName({ name: "Wallet", name_fa: "کیف پول" }, "fa"), "کیف پول");
});

test("pluginName: زبانِ غیرِfa، name (انگلیسی) را برمی‌گرداند", () => {
  assert.equal(pluginName({ name: "Wallet", name_fa: "کیف پول" }, "en"), "Wallet");
  assert.equal(pluginName({ name: "Wallet", name_fa: "کیف پول" }, "ar"), "Wallet");
});

test("pluginName: name_fa خالی برای fa، به name (انگلیسی) می‌افتد نه رشته‌ی خالی", () => {
  assert.equal(pluginName({ name: "Wallet", name_fa: "" }, "fa"), "Wallet");
  assert.equal(pluginName({ name: "Wallet" }, "fa"), "Wallet");
});

test("pluginName: هر دو خالی، fallback صریح برنده می‌شود", () => {
  assert.equal(pluginName({}, "fa", "wallet-id"), "wallet-id");
  assert.equal(pluginName({}, "en", "wallet-id"), "wallet-id");
});

test("pluginDescription: همان قاعده‌ی fa/en برای description_fa/description", () => {
  assert.equal(pluginDescription({ description: "A wallet", description_fa: "یک کیف پول" }, "fa"), "یک کیف پول");
  assert.equal(pluginDescription({ description: "A wallet", description_fa: "یک کیف پول" }, "en"), "A wallet");
});

// ─── productName / productDescription (camelCase — products API) ──────────

test("productName: زبانِ fa، nameFa را برمی‌گرداند", () => {
  assert.equal(productName({ name: "Standard", nameFa: "استاندارد" }, "fa"), "استاندارد");
});

test("productName: زبانِ غیرِfa، name (انگلیسی) را برمی‌گرداند", () => {
  assert.equal(productName({ name: "Standard", nameFa: "استاندارد" }, "en"), "Standard");
  assert.equal(productName({ name: "Standard", nameFa: "استاندارد" }, "ru"), "Standard");
});

test("productName: nameFa خالی برای fa، به name (انگلیسی) می‌افتد نه رشته‌ی خالی", () => {
  assert.equal(productName({ name: "Standard", nameFa: "" }, "fa"), "Standard");
  assert.equal(productName({ name: "Standard" }, "fa"), "Standard");
});

test("productDescription: همان قاعده‌ی fa/en برای descriptionFa/description", () => {
  assert.equal(
    productDescription({ description: "A fast start", descriptionFa: "شروع سریع" }, "fa"),
    "شروع سریع",
  );
  assert.equal(
    productDescription({ description: "A fast start", descriptionFa: "شروع سریع" }, "en"),
    "A fast start",
  );
});

// ─── رگرسیون: shape-ی اشتباه، بدونِ خطای TypeScript، بی‌صدا زبانِ غلط برمی‌گرداند ─
//
// این تست دقیقاً همان باگِ واقعی‌ای است که در همین فاز پیدا و رفع شد —
// pluginName() (snake_case) وقتی روی یک آبجکتِ camelCase (شکلِ Product)
// صدا زده شود، نه خطا می‌دهد نه کار درست را انجام می‌دهد؛ چون
// PluginTextSource همه‌ی فیلدهایش اختیاری‌اند، TypeScript این فراخوانی را
// رد نمی‌کند. productName() برای همین shape درست کار می‌کند.

test("رگرسیون: pluginName روی یک شیِ camelCase (شکلِ Product) بی‌صدا زبانِ اشتباه برمی‌گرداند", () => {
  const product = { name: "Standard", nameFa: "استاندارد" };
  // name_fa در این آبجکت اصلاً وجود ندارد -> pick() آن را undefined می‌بیند
  // و برای fa هم به name (انگلیسی) می‌افتد، نه nameFa.
  assert.equal(pluginName(product, "fa", "fallback"), "Standard");
});

test("رگرسیون: productName همان شیِ camelCase را درست می‌خواند", () => {
  const product = { name: "Standard", nameFa: "استاندارد" };
  assert.equal(productName(product, "fa", "fallback"), "استاندارد");
});
