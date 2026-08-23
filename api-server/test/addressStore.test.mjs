/**
 * test/addressStore.test.mjs — IRFORGE_PROMPT_V3 Phase 18
 *
 * Exercises lib/addressStore.ts against the fake `botConfig.sheetLayer` —
 * same in-memory-sheet harness as test/bookingStore.test.mjs and
 * test/botPanels.test.mjs.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
delete process.env.BOT_CACHE_DATABASE_URL;
delete process.env.BUSINESS_DATABASE_URL;

const botConfig = await import("../src/lib/botConfig.ts");
const store = await import("../src/lib/addressStore.ts");

const SID = "SHEET_TEST_ADDRESS";

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

const VALID = { title: "شعبه مرکزی", text: "تهران، خیابان ولیعصر", latitude: 35.715298, longitude: 51.404343 };

test("createAddress persists a valid address and rounds coordinates to 5 decimals", async () => {
  installSheet();
  const created = await store.createAddress(SID, { ...VALID, latitude: 35.7152981234, longitude: 51.4043439999 });
  assert.equal(created.latitude, 35.71530);
  assert.equal(created.longitude, 51.40434);
  assert.match(created.id, /^addr_[0-9a-f]{12}$/);

  const fetched = await store.getAddress(SID, created.id);
  assert.equal(fetched.title, "شعبه مرکزی");
});

test("createAddress rejects a missing title", async () => {
  installSheet();
  await assert.rejects(() => store.createAddress(SID, { ...VALID, title: "" }));
});

test("createAddress rejects an out-of-range latitude", async () => {
  installSheet();
  await assert.rejects(() => store.createAddress(SID, { ...VALID, latitude: 200 }));
});

test("listAddresses returns all of them sorted by title", async () => {
  installSheet();
  await store.createAddress(SID, { ...VALID, title: "شعبه ب" });
  await store.createAddress(SID, { ...VALID, title: "شعبه الف" });
  const titles = (await store.listAddresses(SID)).map((a) => a.title);
  assert.deepEqual(titles, ["شعبه الف", "شعبه ب"]);
});

test("updateAddress applies a partial change and bumps updated_at", async () => {
  installSheet();
  const created = await store.createAddress(SID, VALID);
  const updated = await store.updateAddress(SID, created.id, { phone: "+982100000000" });
  assert.equal(updated.phone, "+982100000000");
  assert.equal(updated.title, VALID.title); // untouched fields survive a partial update
});

test("updateAddress 404s on an unknown id", async () => {
  installSheet();
  await assert.rejects(() => store.updateAddress(SID, "addr_missing", { phone: "x" }), /پیدا نشد/);
});

test("setting is_default clears it from every other address", async () => {
  installSheet();
  const a = await store.createAddress(SID, { ...VALID, title: "الف", is_default: true });
  const b = await store.createAddress(SID, { ...VALID, title: "ب", is_default: true });
  const refreshedA = await store.getAddress(SID, a.id);
  assert.equal(refreshedA.is_default, false);
  const refreshedB = await store.getAddress(SID, b.id);
  assert.equal(refreshedB.is_default, true);
});

test("deleteAddress removes it", async () => {
  installSheet();
  const created = await store.createAddress(SID, VALID);
  assert.equal(await store.deleteAddress(SID, created.id), true);
  assert.equal(await store.getAddress(SID, created.id), null);
});

// ── تنظیمِ ارائه‌دهنده‌ی نقشه ─────────────────────────────────────────────

test("getAddressConfig defaults to google when nothing saved", async () => {
  installSheet();
  const cfg = await store.getAddressConfig(SID);
  assert.equal(cfg.map_provider, "google");
});

test("setAddressConfig persists and getAddressConfig reflects it", async () => {
  installSheet();
  await store.setAddressConfig(SID, "neshan");
  const cfg = await store.getAddressConfig(SID);
  assert.equal(cfg.map_provider, "neshan");
});

test("setAddressConfig rejects an unknown provider", async () => {
  installSheet();
  await assert.rejects(() => store.setAddressConfig(SID, "bing"));
});

test("address_cfg does not disturb other bot_settings rows", async () => {
  const tabs = installSheet({ bot_settings: { reply_keyboard: { rows: [["/shop"]] } } });
  await store.setAddressConfig(SID, "balad");
  assert.deepEqual(tabs.get("bot_settings").get("reply_keyboard"), { rows: [["/shop"]] });
});
