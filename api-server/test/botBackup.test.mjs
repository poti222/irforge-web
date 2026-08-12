/**
 * test/botBackup.test.mjs — بک‌آپ و بازیابی (فاز ۲۲).
 *
 * معیار پایان فاز: «backup→restore روی یک fake sheet round-trip می‌شود بدون از
 * دست رفتن داده».
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
delete process.env.BOT_CACHE_DATABASE_URL;
delete process.env.BUSINESS_DATABASE_URL;

const backup = await import("../src/routes/botBackup.ts");
const botConfig = await import("../src/lib/botConfig.ts");

const SID = "SHEET_BACKUP";

function installSheet(initial = {}) {
  const tabs = new Map();
  for (const [tab, rows] of Object.entries(initial)) tabs.set(tab, new Map(Object.entries(rows)));
  Object.assign(botConfig.sheetLayer, {
    async readTabRows(_sid, tab) {
      const rows = tabs.get(tab);
      if (!rows) return [];
      return [...rows.entries()].map(([key, value]) => ({ key, value, raw: false }));
    },
    async upsertRow(_sid, tab, key, value) {
      if (!tabs.has(tab)) tabs.set(tab, new Map());
      const created = !tabs.get(tab).has(key);
      tabs.get(tab).set(key, JSON.parse(JSON.stringify(value)));
      return { created };
    },
    async deleteRow(_sid, tab, key) {
      const rows = tabs.get(tab);
      if (!rows?.has(key)) return false;
      rows.delete(key);
      return true;
    },
    async listTabs() { return [...tabs.keys()]; },
  });
  return tabs;
}

/** همان کاری که روت بک‌آپ می‌کند: هر تب → یک `<tab>.json`. */
async function makeBackup(tabs) {
  const files = [];
  for (const tab of tabs.keys()) {
    const payload = {};
    for (const row of await botConfig.listEntity(SID, tab)) payload[row.key] = row.value;
    files.push({ name: `${tab}.json`, data: Buffer.from(JSON.stringify(payload, null, 2), "utf8") });
  }
  return backup.buildZip(files);
}

test("backup → restore round-trip: هیچ داده‌ای گم یا تغییر نمی‌کند", async () => {
  const original = {
    bot_settings: {
      welcome_msg: "سلام! 👋",
      __plugin_states__: { wallet: true },
      working_hours: { enabled: true, days: [0, 1, 2, 3, 4], open_time: "09:00" },
    },
    panels: {
      p1: { id: "p1", title: "خانه", buttons: [{ label: "الف", action: "panel", value: "p2", row: 0, col: 0, row_start: true, style: "" }] },
      p2: { id: "p2", title: "دوم", parent_id: "p1" },
    },
    custom_commands: { shop: { command: "shop", target: "panel:p1", is_active: true } },
  };
  const tabs = installSheet(original);

  const zip = await makeBackup(tabs);
  const files = await backup.readZip(zip);
  assert.deepEqual(files.map((f) => f.name).sort(), ["bot_settings.json", "custom_commands.json", "panels.json"]);

  // محتوای هر فایل باید دقیقاً همان dict کلید→مقدار باشد.
  for (const file of files) {
    const tab = backup.tabNameFromEntry(file.name);
    const parsed = JSON.parse(file.data.toString("utf8"));
    assert.deepEqual(parsed, original[tab], `محتوای ${tab} تغییر کرده است`);
  }

  // بازیابی روی یک شیت خالی باید همه‌چیز را عیناً برگرداند.
  const empty = installSheet({});
  for (const file of files) {
    const tab = backup.tabNameFromEntry(file.name);
    const rows = Object.entries(JSON.parse(file.data.toString("utf8"))).map(([key, value]) => ({ key, value }));
    await botConfig.putEntities(SID, tab, rows);
  }

  for (const [tab, rows] of Object.entries(original)) {
    const restored = {};
    for (const row of await botConfig.listEntity(SID, tab)) restored[row.key] = row.value;
    assert.deepEqual(restored, rows, `تب ${tab} بعد از بازیابی با اصل نمی‌خواند`);
  }
  assert.deepEqual([...empty.keys()].sort(), ["bot_settings", "custom_commands", "panels"]);
});

test("ZIP نوشته‌شده با store و با متن یونیکد هم درست خوانده می‌شود", async () => {
  const data = Buffer.from(JSON.stringify({ "کلید فارسی": "مقدار ✅" }), "utf8");
  const zip = await backup.buildZip([{ name: "روابط.json", data }]);
  const files = await backup.readZip(zip);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "روابط.json");
  assert.deepEqual(JSON.parse(files[0].data.toString("utf8")), { "کلید فارسی": "مقدار ✅" });
});

test("tabNameFromEntry جلوی zip-slip و فایل غیر-JSON را می‌گیرد", () => {
  assert.equal(backup.tabNameFromEntry("panels.json"), "panels");
  assert.equal(backup.tabNameFromEntry("../../etc/passwd.json"), null, "مسیر بالارونده باید رد شود");
  assert.equal(backup.tabNameFromEntry("nested/panels.json"), null, "مسیر تودرتو باید رد شود");
  assert.equal(backup.tabNameFromEntry("evil.sh"), null, "فایل غیر-JSON باید رد شود");
  assert.equal(backup.tabNameFromEntry(".json"), null, "نام خالی باید رد شود");
});

test("ZIP خالی یا خراب پیام روشن می‌دهد، نه crash", async () => {
  await assert.rejects(() => backup.readZip(Buffer.from("not a zip at all")), /پیدا نشد/);
});
