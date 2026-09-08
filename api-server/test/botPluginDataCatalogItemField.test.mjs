/**
 * test/botPluginDataCatalogItemField.test.mjs — IRFORGE_SUBSCRIPTION_CATALOG_LINK_PROMPT Phase B1
 *
 * Covers routes/botPluginData.ts's handling of the new "catalog_item" field
 * type (lib/pluginCollections.ts) used by member-plans.catalog_item_id. It
 * is deliberately NOT one of coerce()'s explicit switch cases -- it must
 * fall through to the same default (free string, maxLength-checked) branch
 * "text"/"image" already use, since there is no static option list to
 * validate a live, per-bot catalog item id against server-side (the bot's
 * own resolve_plan_content() is what actually checks the item still exists,
 * same layered-defense pattern utils/sell_panel.py::resolve_sell_product()
 * already established for the sell panel's own catalog_item_id).
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const { __testables } = await import("../src/routes/botPluginData.ts");
const { coerce, buildPayload } = __testables;

const CATALOG_ITEM_FIELD = {
  key: "catalog_item_id",
  label: { en: "Linked catalog product", fa: "محصولِ کاتالوگِ متصل" },
  type: "catalog_item",
  maxLength: 60,
};

test("coerce یک شناسه‌ی آیتمِ کاتالوگ را مثل یک رشته‌ی معمولی عبور می‌دهد", () => {
  assert.equal(coerce(CATALOG_ITEM_FIELD, "item_abc123def456"), "item_abc123def456");
});

test("coerce رشته‌ی خالی را می‌پذیرد (یعنی «قطعِ اتصال»)", () => {
  assert.equal(coerce(CATALOG_ITEM_FIELD, ""), "");
});

test("coerce وقتی مقدار در ورودی نیست، undefined برمی‌گرداند (دست‌نزن، نه پاک‌کن)", () => {
  assert.equal(coerce(CATALOG_ITEM_FIELD, undefined), undefined);
});

test("coerce طولِ بیش‌ازحد را رد می‌کند، درست مثلِ یک فیلدِ متنی", () => {
  assert.throws(() => coerce(CATALOG_ITEM_FIELD, "x".repeat(61)), /طول/);
});

test("buildPayload یک member-plans با catalog_item_id ساخته‌شده را می‌پذیرد", () => {
  const spec = {
    key: "member-plans",
    fields: [
      { key: "name", label: { en: "Name", fa: "نام" }, type: "text", required: true, maxLength: 80 },
      { key: "price", label: { en: "Price", fa: "قیمت" }, type: "number", min: 0, default: 0 },
      CATALOG_ITEM_FIELD,
    ],
  };
  const payload = buildPayload(spec, { name: "پلن طلایی", price: 10000, catalog_item_id: "item_x" }, true);
  assert.equal(payload.catalog_item_id, "item_x");
});

test("buildPayload برایِ یک پلنِ ساخته‌شده بدونِ catalog_item_id، آن را خالی می‌گذارد", () => {
  const spec = {
    key: "member-plans",
    fields: [
      { key: "name", label: { en: "Name", fa: "نام" }, type: "text", required: true, maxLength: 80 },
      CATALOG_ITEM_FIELD,
    ],
  };
  const payload = buildPayload(spec, { name: "پلن پایه" }, true);
  assert.equal(payload.catalog_item_id, undefined);
});
