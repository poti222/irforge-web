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
  const CORE = ["media", "form", "sell"];
  for (const p of PLUGIN_PANEL_TYPES) assert.ok(!CORE.includes(p.key));
});

test("gameserver_cs2 در PLUGIN_PANEL_TYPES هست", () => {
  const gs = PLUGIN_PANEL_TYPES.find((p) => p.key === "gameserver_cs2");
  assert.ok(gs, "gameserver_cs2 در PLUGIN_PANEL_TYPES نیست");
  assert.equal(gs.pluginId, "gameserver_cs2");
});

test("IRFORGE_TELEGRAM_UPLOAD_PANELTYPES_VPNDELIVERY_PROMPT بخش B — wallet و wallet_balance در یک ردیف ادغام شده‌اند", () => {
  const wallet = PLUGIN_PANEL_TYPES.find((p) => p.key === "wallet");
  const balance = PLUGIN_PANEL_TYPES.find((p) => p.key === "wallet_balance");
  assert.ok(wallet, "wallet در PLUGIN_PANEL_TYPES نیست");
  assert.equal(wallet.pluginId, "wallet");
  // wallet_balance دیگر گزینه‌ی جداگانه‌ای برای پنلِ تازه نیست — سوییچِ
  // shared/personal حالا زیرِ همان یک کلیدِ «wallet» است.
  assert.equal(balance, undefined, "wallet_balance دیگر نباید در PLUGIN_PANEL_TYPES باشد");
});
