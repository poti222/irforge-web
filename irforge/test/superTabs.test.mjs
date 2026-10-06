/**
 * test/superTabs.test.mjs — `/super`: فهرستِ تب‌ها، لینکِ مستقیم (`?tab=`) و قراردادِ «نیازمندِ توجه» با API.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { SUPER_GROUPS_META, SUPER_TAB_META, SUPER_TAB_IDS, DEFAULT_SUPER_TAB, ATTENTION_TABS, isSuperTab, readInitialTab } =
  await import("../src/components/super/superTabs.ts");

test("تب‌ها: شناسه‌ی یکتا، برچسبِ فارسی و انگلیسی، هر گروه حداقل یک تب، و همه‌چیزِ مدیریتی پوشش داده شده", () => {
  assert.equal(new Set(SUPER_TAB_IDS).size, SUPER_TAB_IDS.length, "شناسه‌ی تکراری");
  for (const g of SUPER_GROUPS_META) assert.ok(g.tabs.length > 0 && g.fa && g.en, g.id);
  for (const t of SUPER_TAB_META) assert.ok(t.fa.trim() && t.en.trim(), t.id);
  // هر حوزه‌ای که ادمین لازم دارد یک تب دارد (فهرستِ درخواستِ کاربر: مدارس، ربات‌ها، … «مدیریتِ کامل»)
  for (const must of ["overview", "users", "bots", "schools", "payments", "cardpay", "plans", "products", "discounts", "announcements",
    "updates", "pluginNotes", "tickets", "signups", "sheetPool", "schoolBotPool", "cutover", "sheetsImport", "settings", "audit"]) {
    assert.ok(SUPER_TAB_IDS.includes(must), `تبِ ${must} نیست`);
  }
  assert.equal(SUPER_TAB_IDS.length, 20);
  assert.equal(DEFAULT_SUPER_TAB, "overview");
});

test("readInitialTab: ?tab= معتبر → همان؛ ناشناخته/خالی/خراب → نمای کلی", () => {
  assert.equal(readInitialTab("?tab=schools"), "schools");
  assert.equal(readInitialTab("?x=1&tab=audit"), "audit");
  for (const bad of ["", "?tab=", "?tab=nope", "?tab=__proto__", "?tab=Schools", "tab=schools-x"]) assert.equal(readInitialTab(bad), "overview", bad);
  assert.equal(isSuperTab("cardpay"), true);
  assert.equal(isSuperTab(null), false);
  assert.equal(isSuperTab("constructor"), false);
});

test("«نیازمندِ توجه»: هر کلیدی که API می‌دهد به تبی وصل است و هر تبِ مقصد وجود دارد", () => {
  const api = fs.readFileSync(new URL("../../api-server/src/routes/superDashboard.ts", import.meta.url), "utf8");
  const block = api.slice(api.indexOf("attention: {"), api.indexOf("}", api.indexOf("attention: {")));
  const apiKeys = [...block.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
  assert.ok(apiKeys.length >= 5, apiKeys.join(","));
  assert.deepEqual([...apiKeys].sort(), Object.keys(ATTENTION_TABS).sort(), "کلیدهایِ API و UI باید یکی باشند");
  for (const tab of Object.values(ATTENTION_TABS)) assert.ok(SUPER_TAB_IDS.includes(tab), tab);
});

test("pages/super.tsx: برای هر تب آیکن و محتوا دارد؛ هر تب ErrorBoundaryِ مستقل؛ لینکِ مستقیم با replaceState", () => {
  const src = fs.readFileSync(new URL("../src/pages/super.tsx", import.meta.url), "utf8");
  for (const id of SUPER_TAB_IDS) {
    assert.match(src, new RegExp(`\\b${id}:\\s*(\\(|[A-Z])`), `${id} در TAB_ICONS/TAB_CONTENT نیست`);
  }
  assert.match(src, /<ErrorBoundary inline key=\{tab\}>/);
  assert.match(src, /history\.replaceState/);
  assert.match(src, /requireSuperGate|super-gate\/status/, "گیتِ رمزِ دوم همچنان هست");
});
