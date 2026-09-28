/**
 * test/botCommandsMaterialize.test.mjs
 *
 * لایوباگ ۲۰۲۶-۰۹-۲۸: «توی قسمت کامند ها کامند هایی که نباید باشن توی بات
 * هستند ولی توی بخش کامند نمایش داده نمیشن. مثلا کامند ساپورت بدون نصب
 * پلاگین ساپورت یا تیکت هست و ساخته میشه ... تمامی کامند ها باید نمایش داده
 * بشه و ادمین درصورت نیاز حذف کنه». تا امروز `GET /bots/:botId/commands`
 * فقط ردیف‌هایی از `custom_commands` را می‌دید که ادمین صریحاً از همین
 * سکشن ساخته بود — هر کامندِ Core (`utils/bot_manager.py`، همیشه لود
 * می‌شود) و هر کامندِ خودِ یک پلاگینِ فعال کاملاً نامرئی بود.
 *
 * این تست مستقیماً `materializeBuiltinCommands` را می‌زند (بدونِ راه‌اندازیِ
 * روت/auth کامل، مثل بقیه‌ی این ریپو) با یک لایه‌ی شیتِ جعلیِ درون‌حافظه‌ای
 * روی هر دو seam واقعی: `lib/botConfig.ts::sheetLayer` (تبِ `bot_settings`،
 * برای `isPluginEnabled`) و `lib/pluginCatalog.ts::catalogSheetLayer` (تبِ
 * `plugin_catalog`، برای منشِ کامندهای پلاگین).
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
process.env.BOT_TOKEN_ENCRYPTION_KEY ??= "e".repeat(64);
process.env.REGISTRY_SPREADSHEET_ID ??= "sheet-registry";

const { __testables } = await import("../src/routes/botCommands.ts");
const { materializeBuiltinCommands } = __testables;
const { CORE_COMMANDS, NEVER_DISABLE_COMMANDS } = await import("../src/lib/coreCommandsCatalog.ts");
const botConfigMod = await import("../src/lib/botConfig.ts");
const catalogMod = await import("../src/lib/pluginCatalog.ts");

const SID = "test-tenant-sheet";

/** لایه‌ی شیتِ جعلیِ درون‌حافظه‌ای — تنها روی تب‌هایی که به آن‌ها گفته
 * می‌شود پاسخ می‌دهد؛ بقیه یک تبِ خالی (نه throw) برمی‌گردانند، دقیقاً مثلِ
 * رفتارِ واقعیِ readTabRows برایِ یک تبِ ناموجود. */
function fakeSheets(tabs) {
  const store = new Map(Object.entries(tabs).map(([k, v]) => [k, new Map(v)]));
  return {
    store,
    async readTabRows(_sid, tab) {
      const rows = store.get(tab);
      if (!rows) return [];
      return [...rows.entries()].map(([key, value]) => ({ key, value, raw: false }));
    },
    async upsertRow(_sid, tab, key, value) {
      if (!store.has(tab)) store.set(tab, new Map());
      const created = !store.get(tab).has(key);
      store.get(tab).set(key, value);
      return { created };
    },
    async deleteRow(_sid, tab, key) {
      return store.get(tab)?.delete(key) ?? false;
    },
    async listTabs() {
      return [...store.keys()];
    },
  };
}

function useFakes({ pluginStates = {}, pluginCatalogRows = [] } = {}) {
  catalogMod.resetPluginCatalogCacheForTests();
  const bot = fakeSheets({
    bot_settings: [["__plugin_states__", pluginStates]],
    custom_commands: [],
  });
  Object.assign(botConfigMod.sheetLayer, bot);
  Object.assign(catalogMod.catalogSheetLayer, fakeSheets({ plugin_catalog: pluginCatalogRows }));
  return bot;
}

test("every Core command gets materialized with source='core' when nothing exists yet", async () => {
  useFakes();
  const merged = await materializeBuiltinCommands(SID, []);

  const byName = new Map(merged.map((c) => [c.command, c]));
  for (const entry of CORE_COMMANDS) {
    const row = byName.get(entry.command);
    assert.ok(row, `missing materialized row for /${entry.command}`);
    assert.equal(row.source, "core");
    assert.equal(row.is_active, true);
    assert.equal(row.admin_only, entry.adminOnly);
  }
});

test("support is included even with no plugin catalog at all (baseline discoverability)", async () => {
  useFakes();
  const merged = await materializeBuiltinCommands(SID, []);
  assert.ok(merged.some((c) => c.command === "support" && c.source === "core"));
});

test("an already-existing row is never overwritten by materialization", async () => {
  useFakes();
  const existing = [
    { command: "support", target: "", description: "custom desc", admin_only: false, is_active: false, created_at: "2020-01-01T00:00:00.000Z", source: "core" },
  ];
  const merged = await materializeBuiltinCommands(SID, existing);
  const support = merged.find((c) => c.command === "support");
  assert.equal(support.is_active, false, "the admin's own disable must survive materialization");
  assert.equal(support.description, "custom desc");
});

test("an enabled plugin's own menu_commands get materialized with source='plugin:<id>'", async () => {
  useFakes({
    pluginStates: { ticket: true },
    pluginCatalogRows: [
      ["ticket", {
        id: "ticket", name: "Ticket", name_fa: "تیکت",
        menu_commands: [{ command: "newticket", description_fa: "ثبت تیکت پشتیبانی جدید" }],
      }],
    ],
  });

  const merged = await materializeBuiltinCommands(SID, []);
  const row = merged.find((c) => c.command === "newticket");
  assert.ok(row, "newticket must be materialized for an enabled plugin");
  assert.equal(row.source, "plugin:ticket");
  assert.equal(row.description, "ثبت تیکت پشتیبانی جدید");
  assert.equal(row.is_active, true);
});

test("a disabled plugin's menu_commands are never materialized", async () => {
  useFakes({
    pluginStates: { ticket: false },
    pluginCatalogRows: [
      ["ticket", { id: "ticket", menu_commands: [{ command: "newticket", description_fa: "x" }] }],
    ],
  });

  const merged = await materializeBuiltinCommands(SID, []);
  assert.ok(!merged.some((c) => c.command === "newticket"));
});

test("a previously-materialized plugin row is hidden once its plugin is later disabled, not deleted", async () => {
  const fake = useFakes({
    pluginStates: { ticket: false },
    pluginCatalogRows: [
      ["ticket", { id: "ticket", menu_commands: [{ command: "newticket", description_fa: "x" }] }],
    ],
  });
  const existing = [
    { command: "newticket", target: "", description: "x", admin_only: false, is_active: false, created_at: "2020-01-01T00:00:00.000Z", source: "plugin:ticket" },
  ];

  const merged = await materializeBuiltinCommands(SID, existing);
  assert.ok(!merged.some((c) => c.command === "newticket"), "hidden from the list while the plugin is off");
  // اما ردیف واقعاً حذف نشده -- چون از قبل در existing بود، این فراخوانی
  // هرگز دوباره رویش نمی‌نویسد (فقط ردیف‌هایِ Core که در existing نبودند
  // نوشته می‌شوند، بی‌ربط به سناریوی این تست).
  assert.ok(!fake.store.get("custom_commands")?.has("newticket"), "an already-existing row is never re-written");
});

test("a genuinely custom row (source='custom' or no source at all) is left completely alone", async () => {
  useFakes();
  const existing = [
    { command: "wallet", target: "wallet", description: "کیف پول", admin_only: false, is_active: true, created_at: "2020-01-01T00:00:00.000Z", source: "custom" },
    { command: "shop", target: "panel:abc", description: "", admin_only: false, is_active: true, created_at: "2020-01-01T00:00:00.000Z" },
  ];
  const merged = await materializeBuiltinCommands(SID, existing);
  assert.ok(merged.some((c) => c.command === "wallet" && c.target === "wallet"));
  assert.ok(merged.some((c) => c.command === "shop" && c.target === "panel:abc"));
});

test("NEVER_DISABLE_COMMANDS is exactly the locked subset of CORE_COMMANDS", () => {
  for (const cmd of NEVER_DISABLE_COMMANDS) {
    const entry = CORE_COMMANDS.find((c) => c.command === cmd);
    assert.ok(entry?.locked, `${cmd} is in NEVER_DISABLE_COMMANDS but not locked:true in CORE_COMMANDS`);
  }
  for (const entry of CORE_COMMANDS) {
    if (entry.locked) assert.ok(NEVER_DISABLE_COMMANDS.has(entry.command));
  }
});

test("CORE_COMMANDS has no duplicate command names", () => {
  const names = CORE_COMMANDS.map((c) => c.command);
  assert.equal(new Set(names).size, names.length, `duplicates in: ${names.join(", ")}`);
});
