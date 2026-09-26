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

// ── per-item order-notification targets (PHASE 31) ──────────────────────────

test("createItem defaults notify_admin_ids/notify_group to empty", async () => {
  installSheet();
  const item = await store.createItem(SID, VALID_ITEM, UID);
  assert.deepEqual(item.notify_admin_ids, []);
  assert.equal(item.notify_group, "");
});

test("createItem stores notify_admin_ids and notify_group", async () => {
  installSheet();
  const item = await store.createItem(SID, {
    ...VALID_ITEM,
    notify_admin_ids: ["12345", "-6789"],
    notify_group: "-100999",
  }, UID);
  assert.deepEqual(item.notify_admin_ids, ["12345", "-6789"]);
  assert.equal(item.notify_group, "-100999");
});

test("createItem rejects a non-numeric notify_admin_ids entry or notify_group", async () => {
  installSheet();
  await assert.rejects(
    () => store.createItem(SID, { ...VALID_ITEM, notify_admin_ids: ["@ali_dadaa"] }, UID),
  );
  await assert.rejects(
    () => store.createItem(SID, { ...VALID_ITEM, notify_group: "not-a-number" }, UID),
  );
});

test("createItem rejects notify_admin_ids that isn't an array", async () => {
  installSheet();
  await assert.rejects(() => store.createItem(SID, { ...VALID_ITEM, notify_admin_ids: "12345" }, UID));
});

test("updateItem keeps notify targets untouched when omitted, replaces them when sent", async () => {
  installSheet();
  const item = await store.createItem(SID, { ...VALID_ITEM, notify_admin_ids: ["111"], notify_group: "-100111" }, UID);
  const untouched = await store.updateItem(SID, item.id, { price: 200000 });
  assert.deepEqual(untouched.notify_admin_ids, ["111"]);
  assert.equal(untouched.notify_group, "-100111");

  const replaced = await store.updateItem(SID, item.id, { notify_admin_ids: [], notify_group: "" });
  assert.deepEqual(replaced.notify_admin_ids, []);
  assert.equal(replaced.notify_group, "");
});

test("getItem/listItems default a legacy item with no notify fields to empty", async () => {
  const tabs = installSheet();
  tabs.set("catalog_items", new Map([["item_legacy", { name: "Legacy", name_fa: "قدیمی", price: 1000 }]]));
  const fetched = await store.getItem(SID, "item_legacy");
  assert.deepEqual(fetched.notify_admin_ids, []);
  assert.equal(fetched.notify_group, "");
  assert.deepEqual(fetched.allowed_payment_methods, []);
  assert.deepEqual(fetched.bulk_price_tiers, []);
  assert.deepEqual(fetched.required_intake_fields, []);
});

// ── per-item payment-method restriction (PHASE 32) ──────────────────────────

test("createItem defaults allowed_payment_methods to empty (unrestricted)", async () => {
  installSheet();
  const item = await store.createItem(SID, VALID_ITEM, UID);
  assert.deepEqual(item.allowed_payment_methods, []);
});

test("createItem stores allowed_payment_methods", async () => {
  installSheet();
  const item = await store.createItem(SID, { ...VALID_ITEM, allowed_payment_methods: ["card", "wallet_pay"] }, UID);
  assert.deepEqual(item.allowed_payment_methods, ["card", "wallet_pay"]);
});

test("createItem rejects a non-array or an empty-string entry in allowed_payment_methods", async () => {
  installSheet();
  await assert.rejects(() => store.createItem(SID, { ...VALID_ITEM, allowed_payment_methods: "card" }, UID));
  await assert.rejects(() => store.createItem(SID, { ...VALID_ITEM, allowed_payment_methods: [""] }, UID));
});

test("updateItem keeps allowed_payment_methods untouched when omitted, replaces when sent", async () => {
  installSheet();
  const item = await store.createItem(SID, { ...VALID_ITEM, allowed_payment_methods: ["card"] }, UID);
  const untouched = await store.updateItem(SID, item.id, { price: 5000 });
  assert.deepEqual(untouched.allowed_payment_methods, ["card"]);

  const replaced = await store.updateItem(SID, item.id, { allowed_payment_methods: [] });
  assert.deepEqual(replaced.allowed_payment_methods, []);
});

// ── quantity-discount pricing tiers (PHASE 33) ──────────────────────────────

test("createItem defaults bulk_price_tiers to empty", async () => {
  installSheet();
  const item = await store.createItem(SID, VALID_ITEM, UID);
  assert.deepEqual(item.bulk_price_tiers, []);
});

test("createItem stores well-formed bulk_price_tiers", async () => {
  installSheet();
  const item = await store.createItem(SID, {
    ...VALID_ITEM,
    bulk_price_tiers: [{ min_qty: 10, unit_price: 800 }, { min_qty: 50, unit_price: 600 }],
  }, UID);
  assert.deepEqual(item.bulk_price_tiers, [{ min_qty: 10, unit_price: 800 }, { min_qty: 50, unit_price: 600 }]);
});

test("createItem rejects a tier with min_qty below 2 or a negative unit_price", async () => {
  installSheet();
  await assert.rejects(
    () => store.createItem(SID, { ...VALID_ITEM, bulk_price_tiers: [{ min_qty: 1, unit_price: 800 }] }, UID),
  );
  await assert.rejects(
    () => store.createItem(SID, { ...VALID_ITEM, bulk_price_tiers: [{ min_qty: 10, unit_price: -1 }] }, UID),
  );
});

test("createItem rejects bulk_price_tiers that isn't an array", async () => {
  installSheet();
  await assert.rejects(() => store.createItem(SID, { ...VALID_ITEM, bulk_price_tiers: "nope" }, UID));
});

test("updateItem keeps bulk_price_tiers untouched when omitted, replaces when sent", async () => {
  installSheet();
  const item = await store.createItem(SID, { ...VALID_ITEM, bulk_price_tiers: [{ min_qty: 5, unit_price: 900 }] }, UID);
  const untouched = await store.updateItem(SID, item.id, { price: 5000 });
  assert.deepEqual(untouched.bulk_price_tiers, [{ min_qty: 5, unit_price: 900 }]);

  const replaced = await store.updateItem(SID, item.id, { bulk_price_tiers: [] });
  assert.deepEqual(replaced.bulk_price_tiers, []);
});

// ── pre-payment intake fields (PHASE 34) ────────────────────────────────────

test("createItem defaults required_intake_fields to empty", async () => {
  installSheet();
  const item = await store.createItem(SID, VALID_ITEM, UID);
  assert.deepEqual(item.required_intake_fields, []);
});

test("createItem stores well-formed intake fields, defaulting required to true", async () => {
  installSheet();
  const item = await store.createItem(SID, {
    ...VALID_ITEM,
    required_intake_fields: [
      { name: "addr", label: "آدرس", type: "text" },
      { name: "addons", label: "افزودنی", type: "multi_select", required: false, options: ["الف", "ب"] },
    ],
  }, UID);
  assert.equal(item.required_intake_fields.length, 2);
  assert.equal(item.required_intake_fields[0].required, true);
  assert.equal(item.required_intake_fields[1].required, false);
  assert.deepEqual(item.required_intake_fields[1].options, ["الف", "ب"]);
});

test("createItem rejects an unknown field type", async () => {
  installSheet();
  await assert.rejects(
    () => store.createItem(SID, { ...VALID_ITEM, required_intake_fields: [{ name: "a", label: "A", type: "carrier_pigeon" }] }, UID),
  );
});

test("createItem rejects duplicate field names", async () => {
  installSheet();
  await assert.rejects(
    () => store.createItem(SID, {
      ...VALID_ITEM,
      required_intake_fields: [
        { name: "a", label: "A", type: "text" },
        { name: "a", label: "A again", type: "text" },
      ],
    }, UID),
  );
});

test("createItem rejects a select/multi_select field with no options", async () => {
  installSheet();
  await assert.rejects(
    () => store.createItem(SID, { ...VALID_ITEM, required_intake_fields: [{ name: "a", label: "A", type: "select", options: [] }] }, UID),
  );
});

test("updateItem keeps required_intake_fields untouched when omitted, replaces when sent", async () => {
  installSheet();
  const item = await store.createItem(SID, {
    ...VALID_ITEM,
    required_intake_fields: [{ name: "addr", label: "آدرس", type: "text" }],
  }, UID);
  const untouched = await store.updateItem(SID, item.id, { price: 5000 });
  assert.equal(untouched.required_intake_fields.length, 1);

  const replaced = await store.updateItem(SID, item.id, { required_intake_fields: [] });
  assert.deepEqual(replaced.required_intake_fields, []);
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

// ── فروخته‌شده‌هایِ pool (IRFORGE_POOL_QTY_SOLDLIST_STOREFRONT_PROMPT بخش ۲) ──

function seedPoolRow(tabs, id, fields) {
  if (!tabs.has("catalog_pool_items")) tabs.set("catalog_pool_items", new Map());
  tabs.get("catalog_pool_items").set(id, {
    item_id: "item1", option_id: "", payload_type: "text", status: "delivered",
    order_id: "", buyer_id: "", created_at: "", sold_at: "", delivered_at: "", delivery_error: "",
    ...fields,
  });
}

test("listPoolSold returns only sold/delivered/failed rows for the given item, newest first", async () => {
  const tabs = installSheet();
  seedPoolRow(tabs, "cpi_1", { status: "available", sold_at: "" }); // still in the pool — excluded
  seedPoolRow(tabs, "cpi_2", { status: "delivered", buyer_id: "1", sold_at: "2026-01-01T00:00:00Z" });
  seedPoolRow(tabs, "cpi_3", { status: "sold", buyer_id: "2", sold_at: "2026-02-01T00:00:00Z" });
  seedPoolRow(tabs, "cpi_4", { status: "failed", buyer_id: "3", sold_at: "2026-01-15T00:00:00Z" });
  seedPoolRow(tabs, "cpi_other_item", { item_id: "item2", status: "delivered", sold_at: "2026-03-01T00:00:00Z" });

  const sold = await store.listPoolSold(SID, "item1");
  assert.deepEqual(sold.map((r) => r.id), ["cpi_3", "cpi_4", "cpi_2"]);
});

test("listPoolSold with q matches buyer_id first, falling back to order_id only if nothing matched", async () => {
  const tabs = installSheet();
  seedPoolRow(tabs, "cpi_1", { status: "delivered", buyer_id: "555", order_id: "ORD1" });
  seedPoolRow(tabs, "cpi_2", { status: "delivered", buyer_id: "777", order_id: "555" });

  const byBuyer = await store.listPoolSold(SID, "item1", { q: "555" });
  assert.deepEqual(byBuyer.map((r) => r.id), ["cpi_1"]); // buyer_id match wins even though cpi_2's order_id also equals "555"

  const byOrder = await store.listPoolSold(SID, "item1", { q: "ORD1" });
  assert.deepEqual(byOrder.map((r) => r.id), ["cpi_1"]);
});

test("listPoolSold with an unmatched q returns nothing", async () => {
  const tabs = installSheet();
  seedPoolRow(tabs, "cpi_1", { status: "delivered", buyer_id: "555", order_id: "ORD1" });
  assert.deepEqual(await store.listPoolSold(SID, "item1", { q: "nobody" }), []);
});

test("listPoolSold returns the sold item's own payload/caption, not just buyer/order/status", async () => {
  // IRFORGE_POOL_COMPLETE_PROMPT بخش ۳ -- تبِ فروخته‌شده‌ها باید «خودِ آیتم
  // (لینک/QR)» را هم نشان بدهد، نه فقط خریدار/سفارش/وضعیت. این دقیقاً همان
  // فیلدهایی هستند که plugins/catalog/pool.py::_send_payload به خریدار
  // می‌فرستد -- سایت باید همان دو فیلد را دست‌نخورده به فرانت پاس بدهد.
  const tabs = installSheet();
  seedPoolRow(tabs, "cpi_1", {
    status: "delivered", buyer_id: "1",
    payload_type: "text", payload: "vless://real-link-here", caption: "",
  });
  seedPoolRow(tabs, "cpi_2", {
    status: "delivered", buyer_id: "2",
    payload_type: "photo", payload: "TELEGRAM_FILE_ID_XYZ", caption: "کانفیگِ QR",
  });

  const sold = await store.listPoolSold(SID, "item1");
  const byId = Object.fromEntries(sold.map((r) => [r.id, r]));
  assert.equal(byId.cpi_1.payload, "vless://real-link-here");
  assert.equal(byId.cpi_1.payload_type, "text");
  assert.equal(byId.cpi_2.payload, "TELEGRAM_FILE_ID_XYZ");
  assert.equal(byId.cpi_2.caption, "کانفیگِ QR");
});

// ── مدیریتِ موجودیِ pool از سایت (IRFORGE_TELEGRAM_UPLOAD_PANELTYPES_VPNDELIVERY_PROMPT بخشِ C، آیتمِ ۵) ──

test("getPoolSummary counts rows per status for this item only, plus the low-stock threshold", async () => {
  const tabs = installSheet();
  const item = await store.createItem(SID, VALID_ITEM, UID);
  seedPoolRow(tabs, "cpi_1", { item_id: item.id, status: "available" });
  seedPoolRow(tabs, "cpi_2", { item_id: item.id, status: "available" });
  seedPoolRow(tabs, "cpi_3", { item_id: item.id, status: "sold" });
  seedPoolRow(tabs, "cpi_other", { item_id: "some-other-item", status: "available" });
  await store.setPoolThreshold(SID, item.id, 5);

  const summary = await store.getPoolSummary(SID, item.id);
  assert.deepEqual(summary.counts, { available: 2, reserved: 0, sold: 1, delivered: 0, failed: 0 });
  assert.equal(summary.lowThreshold, 5);
});

test("getPoolSummary 404s on an unknown item", async () => {
  installSheet();
  await assert.rejects(() => store.getPoolSummary(SID, "item_missing"), /پیدا نشد/);
});

test("addPoolItems creates available rows with the given payload/caption", async () => {
  const tabs = installSheet();
  const item = await store.createItem(SID, VALID_ITEM, UID);
  const created = await store.addPoolItems(SID, item.id, [
    { payload_type: "photo", payload: "FILE_ID_1", caption: "لینک ۱" },
    { payload_type: "text", payload: "link-2" },
  ]);
  assert.equal(created.length, 2);
  assert.equal(created[0].status, "available");
  assert.equal(created[0].payload, "FILE_ID_1");
  assert.equal(created[0].caption, "لینک ۱");
  assert.equal(created[1].payload_type, "text");
  assert.equal(tabs.get("catalog_pool_items").size, 2);
});

test("addPoolItems silently skips an entry with an empty payload", async () => {
  const item = await store.createItem(SID, VALID_ITEM, UID);
  const created = await store.addPoolItems(SID, item.id, [{ payload: "  " }, { payload: "real" }]);
  assert.equal(created.length, 1);
  assert.equal(created[0].payload, "real");
});

test("addPoolItemsFromText splits by line by default, each line a separate text item", async () => {
  const item = await store.createItem(SID, VALID_ITEM, UID);
  const created = await store.addPoolItemsFromText(SID, item.id, "line1\nline2\n\nline3");
  assert.deepEqual(created.map((c) => c.payload), ["line1", "line2", "line3"]);
  assert.ok(created.every((c) => c.payload_type === "text"));
});

test("addPoolItemsFromText supports a custom multi-line-per-item separator", async () => {
  const item = await store.createItem(SID, VALID_ITEM, UID);
  const text = "config-a\nline2 of a\n\n\nconfig-b\nline2 of b";
  const created = await store.addPoolItemsFromText(SID, item.id, text, "\n\n");
  assert.equal(created.length, 2);
  assert.equal(created[0].payload, "config-a\nline2 of a");
  assert.equal(created[1].payload, "config-b\nline2 of b");
});

test("deletePoolItem removes an available row", async () => {
  const tabs = installSheet();
  const item = await store.createItem(SID, VALID_ITEM, UID);
  const [row] = await store.addPoolItems(SID, item.id, [{ payload: "a" }]);
  assert.equal(await store.deletePoolItem(SID, item.id, row.id), true);
  assert.equal(tabs.get("catalog_pool_items").has(row.id), false);
});

test("deletePoolItem refuses a sold/delivered row — never deletes order history", async () => {
  const tabs = installSheet();
  const item = await store.createItem(SID, VALID_ITEM, UID);
  seedPoolRow(tabs, "cpi_sold", { item_id: item.id, status: "sold" });
  assert.equal(await store.deletePoolItem(SID, item.id, "cpi_sold"), false);
  assert.equal(tabs.get("catalog_pool_items").has("cpi_sold"), true);
});

test("deletePoolItem refuses a row belonging to a different item", async () => {
  const tabs = installSheet();
  const item = await store.createItem(SID, VALID_ITEM, UID);
  seedPoolRow(tabs, "cpi_x", { item_id: "some-other-item", status: "available" });
  assert.equal(await store.deletePoolItem(SID, item.id, "cpi_x"), false);
});

test("deletePoolItem returns false for an unknown id", async () => {
  const item = await store.createItem(SID, VALID_ITEM, UID);
  assert.equal(await store.deletePoolItem(SID, item.id, "cpi_missing"), false);
});

test("setPoolThreshold merges into metadata.pool without clobbering other pool settings", async () => {
  const tabs = installSheet();
  const item = await store.createItem(SID, VALID_ITEM, UID);
  // `updateItem` عمداً metadata را دست نمی‌زند (برای همین جلوی خودش
  // clobber نمی‌کند) — پس اینجا مستقیم روی خودِ تب می‌نویسیم، دقیقاً همان
  // چیزی که check_low_stock_after_consumption بات هم واقعاً می‌نویسد.
  tabs.get("catalog_items").set(item.id, { ...item, metadata: { pool: { low_alerted: true } } });

  const updated = await store.setPoolThreshold(SID, item.id, 3);
  assert.equal(updated.metadata.pool.low_threshold, 3);
  assert.equal(updated.metadata.pool.low_alerted, true, "پاک نشدن تنظیماتِ دیگرِ pool که خودِ بات نوشته");
});

test("setPoolThreshold rejects a negative threshold", async () => {
  const item = await store.createItem(SID, VALID_ITEM, UID);
  await assert.rejects(() => store.setPoolThreshold(SID, item.id, -1));
});

test("setPoolThreshold 404s on an unknown item", async () => {
  installSheet();
  await assert.rejects(() => store.setPoolThreshold(SID, "item_missing", 3), /پیدا نشد/);
});
