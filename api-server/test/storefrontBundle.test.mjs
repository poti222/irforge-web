/**
 * test/storefrontBundle.test.mjs — IRFORGE_POOL_QTY_SOLDLIST_STOREFRONT_PROMPT بخش ۳.
 *
 * Exercises `lib/pluginPricing.ts::getStorefrontProduct()` and
 * `routes/botPlugins.ts::purchaseStorefrontBundle()` — the "buy Catalog +
 * Wallet together" bundle. Real premise-check finding this codebase already
 * confirmed (see PROGRESS.md): catalog/wallet are already priced+gated real
 * plugins, so this bundle purchases+enables both of them rather than
 * introducing any new gate.
 *
 * `purchaseStorefrontBundle()` deliberately takes an already-resolved
 * `spreadsheetId`/`isSuperAdmin` (not calling `resolveBotSheet()` itself) so
 * it's testable the same way `resolvePurchasePrice()` is in
 * pluginPricing.test.mjs — pure logic, no supertest/Express app needed.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
delete process.env.BOT_CACHE_DATABASE_URL;
delete process.env.BUSINESS_DATABASE_URL;

const {
  db, productsTable, marketplaceItemsTable, installedPluginsTable, botsTable, walletTransactionsTable, walletsTable,
} = await import("@workspace/db");
const botConfig = await import("../src/lib/botConfig.ts");
const pricing = await import("../src/lib/pluginPricing.ts");
const botPlugins = await import("../src/routes/botPlugins.ts");

const { getStorefrontProduct, STOREFRONT_PLUGIN_IDS } = pricing;
const { purchaseStorefrontBundle } = botPlugins;

const SID = "SHEET_TEST_STOREFRONT";
const BOT_ID = "bot_1";
const USER_ID = "user_1";

const STOREFRONT_PRODUCT_ROW = {
  id: "storefront", categoryId: "plugin_bundle", price: 2_200_000 /* rial */, isActive: true, metadata: {},
};

function makeRows(arr) {
  const out = arr.slice();
  out.limit = async (n) => arr.slice(0, n);
  return out;
}

/** همان الگویِ pluginOwners.test.mjs/wallet.test.mjs: یک fakeِ کوچک، دیسپچ بر اساسِ table. */
function installDb({
  productRow = null,
  installedRows = [],
  walletUpdateResult = [{ id: "w1", userId: USER_ID, balance: 999_999_999 }],
  ownerRow = { userId: USER_ID, name: "Test Bot" },
} = {}) {
  const captured = { inserted: [], walletTx: [] };

  db.select = () => ({
    from: (table) => ({
      where: () => {
        if (table === productsTable) return makeRows(productRow ? [productRow] : []);
        if (table === marketplaceItemsTable) return makeRows([{ id: "plugin-x", name: "Plugin", version: "1.0.0" }]);
        if (table === installedPluginsTable) return makeRows(installedRows);
        if (table === botsTable) return makeRows(ownerRow ? [ownerRow] : []);
        return makeRows([]);
      },
    }),
  });

  db.insert = (table) => ({
    values: async (values) => {
      if (table === installedPluginsTable) captured.inserted.push(values);
      if (table === walletTransactionsTable) captured.walletTx.push(values);
      return [values];
    },
  });

  db.update = (table) => ({
    set: () => ({
      where: () => ({
        returning: async () => (table === walletsTable ? walletUpdateResult : []),
      }),
    }),
  });

  return captured;
}

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
    async listTabs() { return [...tabs.keys()]; },
  });
  return tabs;
}

// ── getStorefrontProduct ────────────────────────────────────────────────────

test("getStorefrontProduct: قیمتِ ریالِ دیتابیس به تومان تبدیل می‌شود", async () => {
  installDb({ productRow: STOREFRONT_PRODUCT_ROW });
  const product = await getStorefrontProduct();
  assert.equal(product.id, "storefront");
  assert.equal(product.priceToman, 220_000);
});

test("getStorefrontProduct: ردیفِ ناموجود یا غیرفعال null برمی‌گرداند", async () => {
  installDb({ productRow: null });
  assert.equal(await getStorefrontProduct(), null);
});

// ── purchaseStorefrontBundle ────────────────────────────────────────────────

test("هر دو پلاگین از قبل خریده شده‌اند → ۴۰۹ already_installed، بدون کسرِ کیف‌پول", async () => {
  installSheet();
  const captured = installDb({
    productRow: STOREFRONT_PRODUCT_ROW,
    installedRows: STOREFRONT_PLUGIN_IDS.map((id) => ({ marketplaceItemId: `plugin-${id}`, botId: BOT_ID, name: id })),
  });

  await assert.rejects(
    () => purchaseStorefrontBundle(USER_ID, BOT_ID, SID, false),
    (err) => err.code === "already_installed",
  );
  assert.equal(captured.inserted.length, 0);
});

test("هیچ‌کدام خریده نشده → کیف‌پول یک‌بار به‌اندازه‌ی کاملِ قیمتِ بسته کسر می‌شود، هر دو نصب و روشن می‌شوند", async () => {
  installSheet();
  const captured = installDb({ productRow: STOREFRONT_PRODUCT_ROW, installedRows: [] });

  const result = await purchaseStorefrontBundle(USER_ID, BOT_ID, SID, false);

  assert.deepEqual(result.purchased.slice().sort(), ["catalog", "wallet"]);
  assert.deepEqual(result.alreadyOwned, []);
  assert.equal(captured.inserted.length, 2);
  assert.deepEqual(
    captured.inserted.map((r) => r.marketplaceItemId).sort(),
    ["plugin-catalog", "plugin-wallet"],
  );
  // یک تراکنشِ کیف‌پول، نه دو تا — قیمتِ بسته یک‌جا کسر شد، نه دو خریدِ جدا.
  assert.equal(captured.walletTx.length, 1);
  assert.equal(captured.walletTx[0].amount, 2_200_000);

  const states = await botConfig.getEntity(SID, "bot_settings", "__plugin_states__");
  assert.equal(states.catalog, true);
  assert.equal(states.wallet, true);
});

test("فقط یکی از قبل خریده شده → همان یکی دوباره خریده نمی‌شود، ولی هر دو در پایان روشن می‌شوند", async () => {
  installSheet({ bot_settings: { __plugin_states__: { catalog: false } } }); // خریده شده بود، ولی خاموش
  const captured = installDb({
    productRow: STOREFRONT_PRODUCT_ROW,
    installedRows: [{ marketplaceItemId: "plugin-catalog", botId: BOT_ID, name: "catalog" }],
  });

  const result = await purchaseStorefrontBundle(USER_ID, BOT_ID, SID, false);

  assert.deepEqual(result.purchased, ["wallet"]);
  assert.deepEqual(result.alreadyOwned, ["catalog"]);
  assert.equal(captured.inserted.length, 1);
  assert.equal(captured.inserted[0].marketplaceItemId, "plugin-wallet");
  // هنوز یک بارِ کاملِ قیمتِ بسته کسر شد — مدلِ این بسته تقسیمِ نسبی ندارد.
  assert.equal(captured.walletTx[0].amount, 2_200_000);

  const states = await botConfig.getEntity(SID, "bot_settings", "__plugin_states__");
  assert.equal(states.catalog, true, "خاموش بود، خریدِ فروشگاه‌ساز دوباره روشنش کرد");
  assert.equal(states.wallet, true);
});

test("موجودیِ کیف‌پول کافی نیست → insufficient، هیچ پلاگینی نصب نمی‌شود", async () => {
  installSheet();
  const captured = installDb({ productRow: STOREFRONT_PRODUCT_ROW, installedRows: [], walletUpdateResult: [] });

  await assert.rejects(
    () => purchaseStorefrontBundle(USER_ID, BOT_ID, SID, false),
    (err) => err.code === "insufficient",
  );
  assert.equal(captured.inserted.length, 0);
});

test("بسته هنوز قیمت‌گذاری نشده (ردیفِ products غایب) → storefront_not_priced", async () => {
  installSheet();
  installDb({ productRow: null, installedRows: [] });

  await assert.rejects(
    () => purchaseStorefrontBundle(USER_ID, BOT_ID, SID, false),
    (err) => err.code === "storefront_not_priced",
  );
});

test("سوپرادمین: بدون کسرِ کیف‌پول، حتی اگرbundle قیمت‌گذاری نشده باشد", async () => {
  installSheet();
  const captured = installDb({ productRow: null, installedRows: [] });

  const result = await purchaseStorefrontBundle(USER_ID, BOT_ID, SID, true);
  assert.deepEqual(result.purchased.slice().sort(), ["catalog", "wallet"]);
  assert.equal(captured.walletTx.length, 0, "سوپرادمین هرگز پول نمی‌دهد");

  const states = await botConfig.getEntity(SID, "bot_settings", "__plugin_states__");
  assert.equal(states.catalog, true);
  assert.equal(states.wallet, true);
});
