/**
 * test/panelLabels.test.mjs — labels.ts::panelTypeLabel()'s 3-tier fallback.
 *
 * IRFORGE_WEB_LIST_SYNC_PROMPT فاز ۱ — قبل از این فاز فقط دو لایه بود
 * (کلید locale، بعد خودِ شناسه‌ی خام). لایه‌ی میانیِ تازه (`pluginLabels`،
 * همان `panelTypeLabels`ی که `/panel-catalog` برمی‌گرداند) برای نوعِ
 * پلاگینیِ *تازه‌ای* است که هنوز کلید locale برایش اضافه نشده — بهتر از
 * نشان‌دادنِ شناسه‌ی خام، بدونِ نیاز به یک ترجمه‌ی دومِ دستی.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { panelTypeLabel } = await import("../src/components/bots/panels/labels.ts");

const t = { type_text: "متنی", type_wallet: "💳 کیف پول" };

test("کلید locale موجود، اولویتِ اول است", () => {
  assert.equal(panelTypeLabel(t, "text"), "متنی");
  assert.equal(panelTypeLabel(t, "wallet"), "💳 کیف پول");
});

test("بدونِ کلید locale، برچسبِ زنده‌ی پلاگین (pluginLabels) اولویتِ دوم است", () => {
  assert.equal(panelTypeLabel(t, "new_plugin_type", { new_plugin_type: "🆕 نوع تازه" }), "🆕 نوع تازه");
});

test("بدونِ کلید locale و بدونِ pluginLabels، خودِ شناسه‌ی خام آخرین fallback است", () => {
  assert.equal(panelTypeLabel(t, "totally_unknown"), "totally_unknown");
  assert.equal(panelTypeLabel(t, "totally_unknown", {}), "totally_unknown");
});

test("کلید locale حتی وقتی pluginLabels هم مقدار دارد، برنده می‌ماند", () => {
  assert.equal(panelTypeLabel(t, "wallet", { wallet: "یک ترجمه‌ی دیگر" }), "💳 کیف پول");
});
