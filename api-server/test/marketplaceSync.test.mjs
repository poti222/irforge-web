/**
 * test/marketplaceSync.test.mjs — IRFORGE_PROMPT_V3 Phase 38.
 *
 * `syncPluginMarketplaceItems()` keeps `marketplace_items` in sync with the
 * bot's published catalog. Phase 38 adds one more thing it must do: when a
 * plugin's version actually changes, every `installed_plugins` row for that
 * item has to move to the new version too — otherwise the site keeps
 * showing whatever version a bot happened to be on the day it was bought,
 * forever, even though the bot itself always runs its current plugin code.
 *
 * Catalog control uses the same `catalogSheetLayer` monkeypatch as
 * `pluginCatalog.test.mjs`; `db` control follows `planLimits.test.mjs`'s
 * table-keyed fake.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
process.env.REGISTRY_SPREADSHEET_ID = "sheet-registry";

const { db, marketplaceItemsTable, installedPluginsTable } = await import("@workspace/db");
const catalogMod = await import("../src/lib/pluginCatalog.ts");
const syncMod = await import("../src/lib/marketplaceSync.ts");

function fakeCatalogSheet(rows) {
  return {
    async readTabRows(_sid, tab) {
      assert.equal(tab, catalogMod.CATALOG_TAB);
      return rows.map(([key, value]) => ({ key, value, raw: false }));
    },
  };
}

function useCatalog(manifest) {
  catalogMod.resetPluginCatalogCacheForTests();
  Object.assign(catalogMod.catalogSheetLayer, fakeCatalogSheet([
    [manifest.id, manifest],
    ["__meta__", { published_at: "2026-08-17T00:00:00Z", count: 1, plugin_ids: [manifest.id] }],
  ]));
}

function manifest(overrides = {}) {
  return {
    id: "booking",
    name: "Booking",
    name_fa: "رزرو نوبت",
    description: "desc",
    version: "1.0.0",
    author: "IrForge",
    required_sheets: [],
    permissions: [],
    default_enabled: false,
    ...overrides,
  };
}

function installDb({ existingItem = null } = {}) {
  const marketplaceUpdates = [];
  const installedPluginUpdates = [];
  const inserts = [];

  db.select = () => ({
    from: (table) => ({
      where: () => ({
        limit: async () => (table === marketplaceItemsTable && existingItem ? [existingItem] : []),
      }),
    }),
  });

  db.update = (table) => ({
    set: (patch) => ({
      where: async () => {
        if (table === marketplaceItemsTable) marketplaceUpdates.push(patch);
        if (table === installedPluginsTable) installedPluginUpdates.push(patch);
      },
    }),
  });

  db.insert = (table) => ({
    values: (value) => {
      inserts.push({ table, value });
      return Promise.resolve();
    },
  });

  return { marketplaceUpdates, installedPluginUpdates, inserts };
}

test("نسخه‌ی مانیفست عوض شده → installed_plugins هم به نسخه‌ی تازه به‌روز می‌شود", async () => {
  syncMod.resetMarketplaceSyncForTests();
  useCatalog(manifest({ version: "2.0.0" }));
  const { installedPluginUpdates } = installDb({ existingItem: { id: "plugin-booking", version: "1.0.0" } });

  const result = await syncMod.syncPluginMarketplaceItems();

  assert.equal(result.updated, 1);
  assert.equal(installedPluginUpdates.length, 1);
  assert.equal(installedPluginUpdates[0].version, "2.0.0");
});

test("نسخه‌ی مانیفست تغییر نکرده → هیچ نوشتنی روی installed_plugins انجام نمی‌شود", async () => {
  syncMod.resetMarketplaceSyncForTests();
  useCatalog(manifest({ version: "1.0.0" }));
  const { installedPluginUpdates, marketplaceUpdates } = installDb({ existingItem: { id: "plugin-booking", version: "1.0.0" } });

  await syncMod.syncPluginMarketplaceItems();

  assert.equal(marketplaceUpdates.length, 1, "خودِ آیتم مارکت‌پلیس همیشه به‌روز می‌شود (سایر فیلدها هم ممکن است عوض شده باشند)");
  assert.equal(installedPluginUpdates.length, 0, "بدون تغییرِ نسخه، ردیف‌های نصب‌شده دست‌نخورده می‌مانند");
});

test("آیتمِ تازه (بدون ردیفِ قبلی) → فقط insert، بدون لمسِ installed_plugins", async () => {
  syncMod.resetMarketplaceSyncForTests();
  useCatalog(manifest({ id: "newplugin", version: "1.0.0" }));
  const { installedPluginUpdates, inserts } = installDb({ existingItem: null });

  const result = await syncMod.syncPluginMarketplaceItems();

  assert.equal(result.created, 1);
  assert.equal(inserts.length, 1);
  assert.equal(installedPluginUpdates.length, 0);
});
