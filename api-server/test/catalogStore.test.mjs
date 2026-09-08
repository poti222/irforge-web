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

// ── media / body_html (IRFORGE_CATALOG_RICH_EDITOR_PROMPT Part B) ──────────

test("createItem stores media and sanitizes body_html", async () => {
  installSheet();
  const item = await store.createItem(SID, {
    ...VALID_ITEM,
    media: [{ type: "photo", file_id: "AgAD1", caption: "cover" }],
    body_html: "<b>ویژگی‌ها</b><script>alert(1)</script>",
  }, UID);
  assert.deepEqual(item.media, [{ type: "photo", file_id: "AgAD1", caption: "cover" }]);
  assert.equal(item.body_html, "<b>ویژگی‌ها</b>alert(1)");
});

test("createItem derives legacy image_file_id from the first photo in media", async () => {
  installSheet();
  const item = await store.createItem(SID, {
    ...VALID_ITEM,
    media: [
      { type: "video", file_id: "VID1" },
      { type: "photo", file_id: "PHOTO1" },
    ],
  }, UID);
  assert.equal(item.image_file_id, "PHOTO1");
});

test("createItem rejects a media item missing file_id or with a bad type", async () => {
  installSheet();
  await assert.rejects(() => store.createItem(SID, { ...VALID_ITEM, media: [{ type: "photo", file_id: "" }] }, UID));
  await assert.rejects(() => store.createItem(SID, { ...VALID_ITEM, media: [{ type: "pdf", file_id: "X" }] }, UID));
  await assert.rejects(() => store.createItem(SID, { ...VALID_ITEM, media: "not-an-array" }, UID));
});

test("getItem/listItems normalize a legacy image_file_id-only item into media on read", async () => {
  installSheet();
  const item = await store.createItem(SID, { ...VALID_ITEM, image_file_id: "LEGACY1" }, UID);
  const fetched = await store.getItem(SID, item.id);
  assert.deepEqual(fetched.media, [{ type: "photo", file_id: "LEGACY1", caption: "" }]);

  const [listed] = await store.listItems(SID);
  assert.deepEqual(listed.media, [{ type: "photo", file_id: "LEGACY1", caption: "" }]);
});

test("updateItem sanitizes body_html again and keeps media untouched when omitted", async () => {
  installSheet();
  const item = await store.createItem(SID, {
    ...VALID_ITEM,
    media: [{ type: "photo", file_id: "PHOTO1", caption: "" }],
  }, UID);
  const updated = await store.updateItem(SID, item.id, { body_html: "<div>plain</div><i>ok</i>" });
  assert.equal(updated.body_html, "plain<i>ok</i>");
  assert.deepEqual(updated.media, [{ type: "photo", file_id: "PHOTO1", caption: "" }]);
});

test("createItem accepts fulfillment_type 'pool'", async () => {
  installSheet();
  const item = await store.createItem(SID, { ...VALID_ITEM, fulfillment_type: "pool" }, UID);
  assert.equal(item.fulfillment_type, "pool");
});

// ── buttons (IRFORGE_FULFILLMENT_FORMS_BUTTONS_PROMPT Phase B4) ────────────
//
// Same PanelButton shape/normalization panels already use, but restricted to
// url/panel/mini_app — a product has no destination for form/sell or any
// plugin action.

test("createItem defaults buttons to an empty array", async () => {
  installSheet();
  const item = await store.createItem(SID, VALID_ITEM, UID);
  assert.deepEqual(item.buttons, []);
});

test("createItem stores url/panel/mini_app buttons, normalizing row/col/row_start", async () => {
  installSheet();
  const item = await store.createItem(SID, {
    ...VALID_ITEM,
    buttons: [
      { label: "خرید بیشتر", action: "url", value: "https://example.com", style: "primary" },
      { label: "پنل ما", action: "panel", value: "panel_1" },
    ],
  }, UID);
  assert.equal(item.buttons.length, 2);
  assert.equal(item.buttons[0].row, 0);
  assert.equal(item.buttons[0].row_start, true);
  assert.equal(item.buttons[1].row, 1);
  assert.equal(item.buttons[1].row_start, true);
});

test("createItem rejects a button action outside url/panel/mini_app", async () => {
  installSheet();
  await assert.rejects(
    () => store.createItem(SID, { ...VALID_ITEM, buttons: [{ label: "فرم", action: "form", value: "f1" }] }, UID),
    /اکشنِ دکمه/,
  );
  await assert.rejects(
    () => store.createItem(SID, { ...VALID_ITEM, buttons: [{ label: "تخفیف", action: "discount", value: "" }] }, UID),
    /اکشنِ دکمه/,
  );
});

test("createItem rejects a url/mini_app button whose value isn't https://", async () => {
  installSheet();
  await assert.rejects(
    () => store.createItem(SID, { ...VALID_ITEM, buttons: [{ label: "لینک", action: "url", value: "http://example.com" }] }, UID),
    /https:\/\//,
  );
});

test("createItem rejects an empty button label or a bad style", async () => {
  installSheet();
  await assert.rejects(
    () => store.createItem(SID, { ...VALID_ITEM, buttons: [{ label: "", action: "url", value: "https://x.com" }] }, UID),
  );
  await assert.rejects(
    () => store.createItem(SID, { ...VALID_ITEM, buttons: [{ label: "x", action: "url", value: "https://x.com", style: "rainbow" }] }, UID),
  );
});

test("updateItem keeps buttons untouched when omitted, replaces them when sent", async () => {
  installSheet();
  const item = await store.createItem(SID, {
    ...VALID_ITEM,
    buttons: [{ label: "x", action: "url", value: "https://x.com" }],
  }, UID);
  const untouched = await store.updateItem(SID, item.id, { price: 200000 });
  assert.equal(untouched.buttons.length, 1);

  const replaced = await store.updateItem(SID, item.id, { buttons: [] });
  assert.deepEqual(replaced.buttons, []);
});

test("getItem/listItems default a legacy item with no buttons key to an empty array", async () => {
  const tabs = installSheet();
  const item = await store.createItem(SID, VALID_ITEM, UID);
  // شبیه‌سازیِ یک ردیفِ قدیمی که از قبل از این فاز روی شیت نوشته شده.
  const raw = tabs.get("catalog_items").get(item.id);
  delete raw.buttons;

  const fetched = await store.getItem(SID, item.id);
  assert.deepEqual(fetched.buttons, []);
  const [listed] = await store.listItems(SID);
  assert.deepEqual(listed.buttons, []);
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

// ── fulfillment config — per-type validation (IRFORGE_FULFILLMENT_FORMS_BUTTONS_PROMPT Phase B3) ──
//
// Each case mirrors what the matching executor in plugins/catalog/fulfillment.py
// (irforge-app) actually reads out of `config` — see catalogStore.ts's own
// `validateFulfillmentConfig` for the mapping.

test("setFulfillmentConfig requires a non-empty template for fulfillment_type=template", async () => {
  installSheet();
  const item = await store.createItem(SID, { ...VALID_ITEM, fulfillment_type: "template" }, UID);
  await assert.rejects(() => store.setFulfillmentConfig(SID, item.id, {}), /متنِ پیام/);
  await assert.rejects(() => store.setFulfillmentConfig(SID, item.id, { template: "   " }), /متنِ پیام/);
  const ok = await store.setFulfillmentConfig(SID, item.id, { template: "خوش آمدید {buyer_name}" });
  assert.equal(store.getFulfillmentConfig(ok).template, "خوش آمدید {buyer_name}");
});

test("setFulfillmentConfig requires a file_id and a valid file_kind for fulfillment_type=file", async () => {
  installSheet();
  const item = await store.createItem(SID, { ...VALID_ITEM, fulfillment_type: "file" }, UID);
  await assert.rejects(() => store.setFulfillmentConfig(SID, item.id, {}), /فایل برایِ نوعِ/);
  await assert.rejects(
    () => store.setFulfillmentConfig(SID, item.id, { file_id: "AgAD1", file_kind: "pdf" }),
    /نوعِ فایل/,
  );
  const ok = await store.setFulfillmentConfig(SID, item.id, { file_id: "AgAD1", file_kind: "photo" });
  assert.deepEqual(store.getFulfillmentConfig(ok), { file_id: "AgAD1", file_kind: "photo" });
  // بدون file_kind صریح، دیفالتِ همان executor (document) نوشته می‌شود.
  const defaulted = await store.setFulfillmentConfig(SID, item.id, { file_id: "AgAD1" });
  assert.equal(store.getFulfillmentConfig(defaulted).file_kind, "document");
});

test("setFulfillmentConfig requires a valid http(s) url and method for fulfillment_type=api", async () => {
  installSheet();
  const item = await store.createItem(SID, { ...VALID_ITEM, fulfillment_type: "api" }, UID);
  await assert.rejects(() => store.setFulfillmentConfig(SID, item.id, {}), /آدرسِ API/);
  await assert.rejects(() => store.setFulfillmentConfig(SID, item.id, { url: "not-a-url" }), /آدرسِ API/);
  await assert.rejects(
    () => store.setFulfillmentConfig(SID, item.id, { url: "https://example.com", method: "FETCH" }),
    /متد/,
  );
  await assert.rejects(
    () => store.setFulfillmentConfig(SID, item.id, { url: "https://example.com", headers: "not-an-object" }),
    /هدرها/,
  );
  await assert.rejects(
    () => store.setFulfillmentConfig(SID, item.id, { url: "https://example.com", timeout: -1 }),
    /مهلتِ زمانی/,
  );
  const ok = await store.setFulfillmentConfig(SID, item.id, { url: "https://example.com/issue", method: "get" });
  assert.deepEqual(store.getFulfillmentConfig(ok), { url: "https://example.com/issue", method: "GET" });
});

test("setFulfillmentConfig requires a valid http(s) url for fulfillment_type=webhook", async () => {
  installSheet();
  const item = await store.createItem(SID, { ...VALID_ITEM, fulfillment_type: "webhook" }, UID);
  await assert.rejects(() => store.setFulfillmentConfig(SID, item.id, { url: "ftp://example.com" }), /آدرسِ وبهوک/);
  const ok = await store.setFulfillmentConfig(SID, item.id, { url: "https://example.com/hook" });
  assert.equal(store.getFulfillmentConfig(ok).url, "https://example.com/hook");
});

test("setFulfillmentConfig requires a positive amount_per_unit for fulfillment_type=wallet_credit", async () => {
  installSheet();
  const item = await store.createItem(SID, { ...VALID_ITEM, fulfillment_type: "wallet_credit" }, UID);
  await assert.rejects(() => store.setFulfillmentConfig(SID, item.id, {}), /مبلغِ شارژ/);
  await assert.rejects(() => store.setFulfillmentConfig(SID, item.id, { amount_per_unit: 0 }), /مبلغِ شارژ/);
  await assert.rejects(() => store.setFulfillmentConfig(SID, item.id, { amount_per_unit: -5 }), /مبلغِ شارژ/);
  const ok = await store.setFulfillmentConfig(SID, item.id, { amount_per_unit: 10000, currency: "IRT" });
  assert.deepEqual(store.getFulfillmentConfig(ok), { amount_per_unit: 10000, currency: "IRT" });
});

test("setFulfillmentConfig imposes no shape at all for fulfillment_type=manual or pool", async () => {
  installSheet();
  const manual = await store.createItem(SID, { ...VALID_ITEM, fulfillment_type: "manual" }, UID);
  const pool = await store.createItem(SID, { ...VALID_ITEM, fulfillment_type: "pool" }, UID);
  await store.setFulfillmentConfig(SID, manual.id, { anything: "goes" });
  await store.setFulfillmentConfig(SID, pool.id, { anything: "goes" });
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
