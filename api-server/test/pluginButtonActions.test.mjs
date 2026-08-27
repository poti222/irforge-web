/**
 * test/pluginButtonActions.test.mjs — چکِ سلامتِ نگاشتِ اکشن‌های دکمه‌ی پلاگینی.
 *
 * این جدول آینه‌ی `register_button_action(...)` در `plugins/<id>/plugin.py`ی
 * ریپوی بات است (ریپوی جدا، پس نمی‌شود مثل `pluginPricing.test.mjs` مستقیم
 * فایلش را خواند و برابری زد) — این تست فقط خودِ جدول را برای اشتباهاتِ
 * ساختاری (کلید تکراری، مقدارِ ثابتِ خالی) چک می‌کند.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const { PLUGIN_BUTTON_ACTIONS, CATALOG_ORDER_ACTION } = await import("../src/lib/pluginButtonActions.ts");

test("هر اکشنِ پلاگینی یک key/label/fixedValue غیرخالی دارد", () => {
  for (const a of PLUGIN_BUTTON_ACTIONS) {
    assert.ok(a.pluginId.trim(), "pluginId خالی است");
    assert.ok(a.key.trim(), "key خالی است");
    assert.ok(a.label.trim(), "label خالی است");
    assert.ok(a.fixedValue.trim(), "fixedValue خالی است — این یعنی دکمه بدون callback_data می‌ماند");
  }
});

test("کلیدهای اکشن پلاگینی تکراری نیستند", () => {
  const keys = PLUGIN_BUTTON_ACTIONS.map((a) => a.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("catalog_order جزو PLUGIN_BUTTON_ACTIONS نیست — چون مقدارش ثابت نیست", () => {
  assert.ok(!PLUGIN_BUTTON_ACTIONS.some((a) => a.key === CATALOG_ORDER_ACTION.key));
  assert.equal(CATALOG_ORDER_ACTION.pluginId, "catalog");
});

test("هیچ اکشن پلاگینی با اکشن‌های هسته تداخل ندارد", () => {
  const CORE = ["panel", "url", "mini_app", "form", "sell"];
  for (const a of PLUGIN_BUTTON_ACTIONS) assert.ok(!CORE.includes(a.key));
  assert.ok(!CORE.includes(CATALOG_ORDER_ACTION.key));
});
