/**
 * test/products.test.mjs — IRFORGE_PRODUCTS_SECTION_PROMPT Phase 2.
 *
 * routes/products.ts's request handlers are express route bodies, thin over
 * db calls — same shape as routes/plans.ts, which has no dedicated test file
 * anywhere in this suite. Following the same convention every other route
 * test in this suite already uses (paymentConfig.test.mjs, botPluginData.test.mjs,
 * ...): the validation/formatting logic is extracted into `__testables` and
 * tested directly, rather than simulating HTTP requests against the Router —
 * a technique no test file in this repo uses.
 *
 * The one genuinely money-critical read path (bot-tier pricing) is a real
 * `db.select` against `productsTable`, covered with a mocked db in
 * pluginPricing.test.mjs (getBotTierProduct()/resolvePurchasePrice()), not
 * duplicated here.
 *
 * Seed-data coverage: parses migrate.mjs's own INSERT statements statically,
 * the same technique pluginPricing.test.mjs used (before this phase) to
 * drift-check bot-tiers.ts's source against the old hardcoded BOT_TIER_PRICES.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const { __testables } = await import("../src/routes/products.ts");
const {
  slugify, parsePriceToman, coerceMetadata, formatProduct, formatCategory,
  isBotCategoryId, botCategoryPatchViolation,
} = __testables;

// ─── slugify ────────────────────────────────────────────────────────────────

test("slugify: یک عنوانِ خوانا را به شناسه‌ی url-safe تبدیل می‌کند", () => {
  assert.equal(slugify("Virtual Account"), "virtual-account");
  assert.equal(slugify("  API  "), "api");
});

test("slugify: خروجیِ خالی (مثلاً عنوانِ کاملاً فارسی) به یک id تصادفیِ غیرخالی می‌افتد", () => {
  const out = slugify("حسابیار");
  assert.ok(out.length > 0);
});

// ─── parsePriceToman ────────────────────────────────────────────────────────

test("parsePriceToman: عددِ صفر یا مثبت پذیرفته می‌شود", () => {
  assert.equal(parsePriceToman(0), 0);
  assert.equal(parsePriceToman(500000), 500000);
  assert.equal(parsePriceToman("1100000"), 1100000);
});

test("parsePriceToman: منفی رد می‌شود", () => {
  assert.throws(() => parsePriceToman(-1), /non-negative/);
});

test("parsePriceToman: غیرعددی رد می‌شود", () => {
  assert.throws(() => parsePriceToman("abc"), /non-negative/);
  assert.throws(() => parsePriceToman(undefined), /non-negative/);
  assert.throws(() => parsePriceToman(null), /non-negative/);
  assert.throws(() => parsePriceToman(NaN), /non-negative/);
  assert.throws(() => parsePriceToman(Infinity), /non-negative/);
});

// ─── coerceMetadata ─────────────────────────────────────────────────────────

test("coerceMetadata: یک آبجکتِ معمولی دست‌نخورده می‌ماند", () => {
  assert.deepEqual(coerceMetadata({ ramGb: 1, popular: true }), { ramGb: 1, popular: true });
});

test("coerceMetadata: آرایه، رشته، عدد و null به آبجکتِ خالی می‌افتند", () => {
  assert.deepEqual(coerceMetadata(["a", "b"]), {});
  assert.deepEqual(coerceMetadata("not an object"), {});
  assert.deepEqual(coerceMetadata(42), {});
  assert.deepEqual(coerceMetadata(null), {});
  assert.deepEqual(coerceMetadata(undefined), {});
});

// ─── formatProduct / formatCategory ─────────────────────────────────────────

test("formatProduct: قیمت از ریالِ دیتابیس به تومانِ API تبدیل می‌شود", () => {
  const row = {
    id: "standard", categoryId: "bot", name: "Standard", nameFa: "استاندارد",
    description: "desc", descriptionFa: "توضیح", price: 5000000, isActive: true,
    icon: "Bot", sortOrder: 0, metadata: { ramGb: 1 },
  };
  const out = formatProduct(row);
  assert.equal(out.price, 500000, "5,000,000 ریال باید 500,000 تومان نشان داده شود");
  assert.equal(out.id, "standard");
  assert.deepEqual(out.metadata, { ramGb: 1 });
});

test("formatCategory: فیلدهای عمومی را بدونِ تغییر منتقل می‌کند", () => {
  const row = { id: "bot", labelFa: "بات", labelEn: "Bot", icon: "Bot", sortOrder: 0, isActive: true };
  assert.deepEqual(formatCategory(row), row);
});

// ─── سیدِ اولیه (migrate.mjs) ────────────────────────────────────────────────

const migrateSource = fs.readFileSync(new URL("../migrate.mjs", import.meta.url), "utf8");

test("سیدِ اولیه: هر شش دسته در migrate.mjs موجودند", () => {
  const EXPECTED_CATEGORIES = ["bot", "virtual_account", "virtual_card", "api", "accountant", "school"];
  for (const id of EXPECTED_CATEGORIES) {
    assert.ok(
      migrateSource.includes(`'${id}'`),
      `دسته‌ی «${id}» در سیدِ product_categories پیدا نشد`,
    );
  }
});

test("سیدِ اولیه: دو محصولِ بات (standard/pro) با قیمتِ ریالیِ درست", () => {
  // بلوکِ INSERT INTO products را جدا می‌کنیم تا با بلوکِ INSERT INTO
  // product_categories (که هم آیدیِ 'bot' دارد) قاطی نشود.
  const block = migrateSource.split("INSERT INTO products")[1]?.split("ON CONFLICT")[0] ?? "";
  assert.ok(block.includes("'standard'"), "ردیفِ استاندارد در سیدِ products پیدا نشد");
  assert.ok(block.includes("'pro'"), "ردیفِ پرو در سیدِ products پیدا نشد");
  // 500,000/1,100,000 تومانِ قدیمیِ bot-tiers.ts × ۱۰ = ریال.
  assert.ok(block.includes("5000000"), "قیمتِ استاندارد (۵,۰۰۰,۰۰۰ ریال) در سید پیدا نشد");
  assert.ok(block.includes("11000000"), "قیمتِ پرو (۱۱,۰۰۰,۰۰۰ ریال) در سید پیدا نشد");
});

test("سیدِ اولیه: metadataی محصولاتِ بات، maxFreePlugins دارد نه maxPlugins (تغییرِ نامِ عمدی)", () => {
  const block = migrateSource.split("INSERT INTO products")[1]?.split("ON CONFLICT")[0] ?? "";
  assert.ok(block.includes("maxFreePlugins"), "maxFreePlugins در metadataی سید پیدا نشد");
  assert.ok(!block.includes('"maxPlugins"'), "نامِ قدیمیِ maxPlugins نباید در metadataی محصولِ بات باقی مانده باشد");
});

// ─── isBotCategoryId / botCategoryPatchViolation (Phase 4، بخشِ D) ───────────
// دسته‌ی «بات» ثابت است: دقیقاً همان دو محصولِ Standard/Pro که Phase 2 seed
// کرده — نه پلنِ سوم، نه ویرایشِ فیلدهایی جز قیمت.

test("isBotCategoryId: فقط رشته‌ی دقیقِ 'bot' را تشخیص می‌دهد", () => {
  assert.equal(isBotCategoryId("bot"), true);
  assert.equal(isBotCategoryId("virtual_account"), false);
  assert.equal(isBotCategoryId(undefined), false);
  assert.equal(isBotCategoryId(null), false);
});

test("botCategoryPatchViolation: محصولِ دسته‌ی بات — تغییرِ فقط price مجاز است", () => {
  assert.deepEqual(botCategoryPatchViolation("bot", { price: 600000 }), []);
});

test("botCategoryPatchViolation: محصولِ دسته‌ی بات — تغییرِ isActive رد می‌شود (حذفِ نرم/افزودنِ پلنِ سوم)", () => {
  assert.deepEqual(botCategoryPatchViolation("bot", { isActive: false }), ["isActive"]);
  assert.deepEqual(botCategoryPatchViolation("bot", { isActive: true }), ["isActive"]);
});

test("botCategoryPatchViolation: محصولِ دسته‌ی بات — تغییرِ name/categoryId/metadata همراهِ price هم رد می‌شود", () => {
  const violation = botCategoryPatchViolation("bot", { price: 600000, name: "New name", categoryId: "api" });
  assert.deepEqual(violation.sort(), ["categoryId", "name"]);
});

test("botCategoryPatchViolation: محصولِ یک دسته‌ی دیگر که با این درخواست به «بات» منتقل می‌شود هم قفل می‌خورد", () => {
  const violation = botCategoryPatchViolation("api", { categoryId: "bot", name: "x" });
  assert.deepEqual(violation.sort(), ["categoryId", "name"]);
});

test("botCategoryPatchViolation: محصولِ دسته‌های دیگر آزادانه ویرایش می‌شود", () => {
  assert.deepEqual(botCategoryPatchViolation("virtual_account", { name: "x", price: 1, isActive: false }), []);
});
