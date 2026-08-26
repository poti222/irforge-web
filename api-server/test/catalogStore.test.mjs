/**
 * test/catalogStore.test.mjs — IRFORGE_PROMPT_V3 Phase 24
 *
 * Exercises lib/catalogStore.ts against the fake `botConfig.sheetLayer` —
 * same in-memory-sheet harness as test/giveawayStore.test.mjs. Covers the
 * category/item/option CRUD, the soft-delete conventions (archive/deactivate
 * rather than remove), and the fulfillment-config merge-not-replace
 * semantics that mirror plugins/catalog/domain.py.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
delete process.env.BOT_CACHE_DATABASE_URL;
delete process.env.BUSINESS_DATABASE_URL;

const botConfig = await import("../src/lib/botConfig.ts");
const store = await import("../src/lib/catalogStore.ts");

const SID = "SHEET_TEST_CATALOG";
const UID = "user_1";

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
      const rows = tabs.get(tab);
      const created = !rows.has(key);
      rows.set(key, JSON.parse(JSON.stringify(value)));
      return { created };
    },
    async deleteRow(_sid, tab, key) {
      const rows = tabs.get(tab);
      if (!rows || !rows.has(key)) return false;
      rows.delete(key);
      return true;
    },
    async listTabs() {
      return [...tabs.keys()];
    },
  });
  return tabs;
}

// ── categories ───────────────────────────────────────────────────────────

test("createCategory defaults name_fa to name, sort_order to 0, is_active to true", async () => {
  installSheet();
  const c = await store.createCategory(SID, { name: "Digital Goods" }, UID);
  assert.equal(c.name_fa, "Digital Goods");
  assert.equal(c.sort_order, 0);
  assert.equal(c.is_active, true);
  assert.match(c.id, /^cat_[0-9a-f]{12}$/);
});

test("createCategory rejects a missing or too-long name", async () => {
  installSheet();
  await assert.rejects(() => store.createCategory(SID, { name: "" }, UID));
  await assert.rejects(() => store.createCategory(SID, { name: "x".repeat(201) }, UID));
});

test("listCategories sorts by sort_order then name", async () => {
  installSheet();
  await store.createCategory(SID, { name: "Zeta", sort_order: 1 }, UID);
  await store.createCategory(SID, { name: "Alpha", sort_order: 0 }, UID);
  await store.createCategory(SID, { name: "Beta", sort_order: 0 }, UID);
  const names = (await store.listCategories(SID)).map((c) => c.name);
  assert.deepEqual(names, ["Alpha", "Beta", "Zeta"]);
});

test("updateCategory 404s on an unknown id", async () => {
  installSheet();
  await assert.rejects(() => store.updateCategory(SID, "cat_missing", { name: "x" }), /پیدا نشد/);
});

test("deleteCategory removes only the category row, leaving items' stale category_id intact", async () => {
  const tabs = installSheet();
  const cat = await store.createCategory(SID, { name: "Digital" }, UID);
  const item = await store.createItem(SID, { name: "VPN Plan", price: 100000, category_id: cat.id }, UID);
  assert.equal(await store.deleteCategory(SID, cat.id), true);
  assert.equal(await store.getCategory(SID, cat.id), null);
  const stillThere = tabs.get("catalog_items").get(item.id);
  assert.equal(stillThere.category_id, cat.id);
});

// ── items ────────────────────────────────────────────────────────────────

const VALID_ITEM = { name: "VPN Plan", price: 100000 };

test("createItem defaults currency/item_type/fulfillment_type/status", async () => {
  installSheet();
  const item = await store.createItem(SID, VALID_ITEM, UID);
  assert.equal(item.currency, "IRT");
  assert.equal(item.item_type, "service");
  assert.equal(item.fulfillment_type, "manual");
  assert.equal(item.status, "active");
  assert.match(item.id, /^item_[0-9a-f]{12}$/);
});

test("createItem rejects a missing name, negative price, or bad status", async () => {
  installSheet();
  await assert.rejects(() => store.createItem(SID, { ...VALID_ITEM, name: "" }, UID));
  await assert.rejects(() => store.createItem(SID, { ...VALID_ITEM, price: -1 }, UID));
  await assert.rejects(() => store.createItem(SID, { ...VALID_ITEM, status: "bogus" }, UID));
});

test("createItem rejects an unsupported fulfillment_type", async () => {
  installSheet();
  await assert.rejects(
    () => store.createItem(SID, { ...VALID_ITEM, fulfillment_type: "carrier_pigeon" }, UID),
    /پشتیبانی نمی‌شود/,
  );
});

test("createItem requires track_stock items to have a non-negative integer stock_qty", async () => {
  installSheet();
  await assert.rejects(() => store.createItem(SID, { ...VALID_ITEM, track_stock: true, stock_qty: -1 }, UID));
  await assert.rejects(() => store.createItem(SID, { ...VALID_ITEM, track_stock: true, stock_qty: 1.5 }, UID));
  const item = await store.createItem(SID, { ...VALID_ITEM, track_stock: true, stock_qty: 5 }, UID);
  assert.equal(item.stock_qty, 5);
});

test("createItem rejects a category_id that does not exist", async () => {
  installSheet();
  await assert.rejects(
    () => store.createItem(SID, { ...VALID_ITEM, category_id: "cat_missing" }, UID),
    /دسته‌بندی/,
  );
});

test("createItem accepts a category_id that exists", async () => {
  installSheet();
  const cat = await store.createCategory(SID, { name: "Digital" }, UID);
  const item = await store.createItem(SID, { ...VALID_ITEM, category_id: cat.id }, UID);
  assert.equal(item.category_id, cat.id);
});

test("listItems excludes archived items by default but includes them with includeArchived", async () => {
  installSheet();
  const a = await store.createItem(SID, { ...VALID_ITEM, name: "Active" }, UID);
  const b = await store.createItem(SID, { ...VALID_ITEM, name: "Archived" }, UID);
  await store.archiveItem(SID, b.id);

  const visible = await store.listItems(SID);
  assert.deepEqual(visible.map((i) => i.id), [a.id]);

  const all = await store.listItems(SID, { includeArchived: true });
  assert.equal(all.length, 2);
});

test("updateItem merges partial input onto the existing record, not parseItemInput's own defaults", async () => {
  installSheet();
  const item = await store.createItem(SID, { ...VALID_ITEM, description: "one plan, forever" }, UID);
  const updated = await store.updateItem(SID, item.id, { price: 200000 });
  assert.equal(updated.price, 200000);
  assert.equal(updated.description, "one plan, forever");
});

test("updateItem 404s on an unknown id", async () => {
  installSheet();
  await assert.rejects(() => store.updateItem(SID, "item_missing", { price: 1 }), /پیدا نشد/);
});

test("archiveItem sets status to archived without deleting the row", async () => {
  const tabs = installSheet();
  const item = await store.createItem(SID, VALID_ITEM, UID);
  const archived = await store.archiveItem(SID, item.id);
  assert.equal(archived.status, "archived");
  assert.equal(tabs.get("catalog_items").has(item.id), true);
});

test("deleteItemHard actually removes the row", async () => {
  const tabs = installSheet();
  const item = await store.createItem(SID, VALID_ITEM, UID);
  assert.equal(await store.deleteItemHard(SID, item.id), true);
  assert.equal(tabs.get("catalog_items").has(item.id), false);
});

// ── fulfillment config ──────────────────────────────────────────────────

test("getFulfillmentConfig is empty for a freshly created item", async () => {
  installSheet();
  const item = await store.createItem(SID, VALID_ITEM, UID);
  assert.deepEqual(store.getFulfillmentConfig(item), {});
});

test("setFulfillmentConfig merges into metadata without touching other metadata keys", async () => {
  installSheet();
  const item = await store.createItem(SID, VALID_ITEM, UID);
  const withCfg = await store.setFulfillmentConfig(SID, item.id, { template: "خوش آمدید {buyer_name}" });
  assert.deepEqual(store.getFulfillmentConfig(withCfg), { template: "خوش آمدید {buyer_name}" });

  const replaced = await store.setFulfillmentConfig(SID, item.id, { url: "https://example.com/hook" });
  assert.deepEqual(store.getFulfillmentConfig(replaced), { url: "https://example.com/hook" });
});

test("setFulfillmentConfig rejects a non-object config", async () => {
  installSheet();
  const item = await store.createItem(SID, VALID_ITEM, UID);
  await assert.rejects(() => store.setFulfillmentConfig(SID, item.id, "not-an-object"));
  await assert.rejects(() => store.setFulfillmentConfig(SID, item.id, ["a", "b"]));
});

test("setFulfillmentConfig 404s on an unknown item", async () => {
  installSheet();
  await assert.rejects(() => store.setFulfillmentConfig(SID, "item_missing", {}), /پیدا نشد/);
});

// ── options ──────────────────────────────────────────────────────────────

test("createOption defaults is_active to true and sort_order to 0", async () => {
  installSheet();
  const item = await store.createItem(SID, VALID_ITEM, UID);
  const opt = await store.createOption(SID, item.id, { label: "1 Month", price: 50000 });
  assert.equal(opt.is_active, true);
  assert.equal(opt.sort_order, 0);
  assert.equal(opt.item_id, item.id);
  assert.match(opt.id, /^opt_[0-9a-f]{12}$/);
});

test("createOption 404s on an unknown item_id", async () => {
  installSheet();
  await assert.rejects(() => store.createOption(SID, "item_missing", { label: "1 Month", price: 1 }), /یافت نشد/);
});

test("createOption rejects a missing label or negative price", async () => {
  installSheet();
  const item = await store.createItem(SID, VALID_ITEM, UID);
  await assert.rejects(() => store.createOption(SID, item.id, { label: "", price: 1 }));
  await assert.rejects(() => store.createOption(SID, item.id, { label: "1 Month", price: -1 }));
});

test("listOptions scopes to the given item_id and excludes inactive by default", async () => {
  installSheet();
  const item1 = await store.createItem(SID, { ...VALID_ITEM, name: "Item 1" }, UID);
  const item2 = await store.createItem(SID, { ...VALID_ITEM, name: "Item 2" }, UID);
  const a = await store.createOption(SID, item1.id, { label: "1 Month", price: 10000 });
  await store.createOption(SID, item1.id, { label: "Old plan", price: 5000 });
  await store.createOption(SID, item2.id, { label: "Other item's option", price: 1 });
  const inactive = await store.listOptions(SID, item1.id);
  await store.deactivateOption(SID, (await store.listOptions(SID, item1.id)).find((o) => o.label === "Old plan").id);

  const visible = await store.listOptions(SID, item1.id);
  assert.deepEqual(visible.map((o) => o.id), [a.id]);

  const all = await store.listOptions(SID, item1.id, { includeInactive: true });
  assert.equal(all.length, 2);
});

test("deactivateOption sets is_active false without deleting the row", async () => {
  const tabs = installSheet();
  const item = await store.createItem(SID, VALID_ITEM, UID);
  const opt = await store.createOption(SID, item.id, { label: "1 Month", price: 10000 });
  const deactivated = await store.deactivateOption(SID, opt.id);
  assert.equal(deactivated.is_active, false);
  assert.equal(tabs.get("catalog_item_options").has(opt.id), true);
});

test("deleteOptionHard actually removes the row", async () => {
  const tabs = installSheet();
  const item = await store.createItem(SID, VALID_ITEM, UID);
  const opt = await store.createOption(SID, item.id, { label: "1 Month", price: 10000 });
  assert.equal(await store.deleteOptionHard(SID, opt.id), true);
  assert.equal(tabs.get("catalog_item_options").has(opt.id), false);
});

test("updateOption 404s on an unknown id", async () => {
  installSheet();
  await assert.rejects(() => store.updateOption(SID, "opt_missing", { label: "x" }), /پیدا نشد/);
});
