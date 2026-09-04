/**
 * test/pluginPanelTypes.test.mjs — چکِ سلامتِ نگاشتِ انواعِ پنلِ پلاگینی.
 *
 * IRFORGE_WEB_LIST_SYNC_PROMPT فاز ۱ — این جدول آینه‌ی
 * `register_panel_type(...)` در `plugins/<id>/plugin.py`ی ریپوی بات است
 * (ریپوی جدا، پس نمی‌شود مستقیم فایلش را خواند و برابری زد) — دقیقاً همان
 * الگویی که `pluginButtonActions.test.mjs` برای اکشن‌های دکمه دارد: فقط خودِ
 * جدول را برای اشتباهاتِ ساختاری (کلید تکراری، تداخل با هسته) چک می‌کند.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const { PLUGIN_PANEL_TYPES } = await import("../src/lib/pluginPanelTypes.ts");

test("هر نوعِ پنلِ پلاگینی یک pluginId/key/label غیرخالی دارد", () => {
  for (const p of PLUGIN_PANEL_TYPES) {
    assert.ok(p.pluginId.trim(), "pluginId خالی است");
    assert.ok(p.key.trim(), "key خالی است");
    assert.ok(p.label.trim(), "label خالی است");
  }
});

test("کلیدهای نوعِ پنلِ پلاگینی تکراری نیستند", () => {
  const keys = PLUGIN_PANEL_TYPES.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("هیچ نوعِ پنلِ پلاگینی با انواعِ هسته تداخل ندارد", () => {
  const CORE = ["text", "photo", "carousel", "video", "audio", "document", "form", "sell"];
  for (const p of PLUGIN_PANEL_TYPES) assert.ok(!CORE.includes(p.key));
});

test("هر دو نوعِ پنلِ کیف‌پول (wallet, wallet_balance) حاضرند و برچسبِ جدا دارند", () => {
  const wallet = PLUGIN_PANEL_TYPES.find((p) => p.key === "wallet");
  const balance = PLUGIN_PANEL_TYPES.find((p) => p.key === "wallet_balance");
  assert.ok(wallet, "wallet در PLUGIN_PANEL_TYPES نیست");
  assert.ok(balance, "wallet_balance در PLUGIN_PANEL_TYPES نیست");
  assert.equal(wallet.pluginId, "wallet");
  assert.equal(balance.pluginId, "wallet");
  assert.notEqual(wallet.label, balance.label);
});
