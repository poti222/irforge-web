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

// ── IRFORGE_BOOKING_FORM_CONTACT_REFERRAL_PROMPT پیگیری — contact_entries ───
//
// آینه‌ی همان قاعده‌ای که برای نوعِ پنلِ core «contact_info» نوشته شده بود
// (`test/panelContactEntries.test.mjs`، حالا حذف‌شده، ادغام‌شده اینجا)، فقط
// اینجا با entryهای سطحِ آدرس، نه پنل.

function entry(overrides = {}) {
  return { kind: "phone", label: "شماره فروش", value: "02112345678", ...overrides };
}

test("createAddress without contact_entries defaults to an empty list", async () => {
  installSheet();
  const created = await store.createAddress(SID, VALID);
  assert.deepEqual(created.contact_entries, []);
});

test("createAddress persists valid contact_entries", async () => {
  installSheet();
  const entries = [entry({ id: "ce1" }), entry({ id: "ce2", kind: "link", value: "https://wa.me/98912xxxxxxx" })];
  const created = await store.createAddress(SID, { ...VALID, contact_entries: entries });
  assert.deepEqual(created.contact_entries, entries);
});

test("updateAddress can replace contact_entries", async () => {
  installSheet();
  const created = await store.createAddress(SID, VALID);
  const updated = await store.updateAddress(SID, created.id, {
    contact_entries: [entry({ id: "ce1", kind: "email", value: "a@b.com" })],
  });
  assert.equal(updated.contact_entries.length, 1);
  assert.equal(updated.contact_entries[0].kind, "email");
});

test("contact_entries rejects a non-array value", async () => {
  installSheet();
  await assert.rejects(() => store.createAddress(SID, { ...VALID, contact_entries: {} }));
});

test("contact_entries rejects more than 20 entries", async () => {
  installSheet();
  const many = Array.from({ length: 21 }, () => entry());
  await assert.rejects(() => store.createAddress(SID, { ...VALID, contact_entries: many }));
});

test("contact_entries rejects an unknown kind", async () => {
  installSheet();
  await assert.rejects(() => store.createAddress(SID, { ...VALID, contact_entries: [entry({ kind: "fax" })] }));
});

test("contact_entries rejects an empty label", async () => {
  installSheet();
  await assert.rejects(() => store.createAddress(SID, { ...VALID, contact_entries: [entry({ label: "  " })] }));
});

test("contact_entries kind=link with https:// is accepted", async () => {
  installSheet();
  const created = await store.createAddress(SID, {
    ...VALID, contact_entries: [entry({ kind: "link", value: "https://t.me/example" })],
  });
  assert.equal(created.contact_entries[0].value, "https://t.me/example");
});

test("contact_entries kind=link with tel: is rejected — دقیقاً همان درسِ بخشِ ۴", async () => {
  installSheet();
  await assert.rejects(
    () => store.createAddress(SID, { ...VALID, contact_entries: [entry({ kind: "link", value: "tel:+98912xxxxxxx" })] }),
    (err) => err.message.includes("https://"),
  );
});

test("contact_entries kind=phone has no https:// requirement — any text is accepted", async () => {
  installSheet();
  const created = await store.createAddress(SID, {
    ...VALID, contact_entries: [entry({ kind: "phone", value: "021-12345678" })],
  });
  assert.equal(created.contact_entries[0].value, "021-12345678");
});

// ── User report: "همه‌ی فیلدها اجباریه" — فقط title باید اجباری بمونه ────────

test("createAddress only requires a title — text and location are optional", async () => {
  installSheet();
  const created = await store.createAddress(SID, { title: "فقط عنوان" });
  assert.equal(created.text, "");
  assert.equal(created.latitude, null);
  assert.equal(created.longitude, null);
});

test("createAddress with only a phone number, no text, no location", async () => {
  installSheet();
  const created = await store.createAddress(SID, { title: "داخلی", phone: "02112345678" });
  assert.equal(created.phone, "02112345678");
  assert.equal(created.text, "");
  assert.equal(created.latitude, null);
});

test("createAddress rejects latitude without longitude — a half-set pair is not a location", async () => {
  installSheet();
  await assert.rejects(() => store.createAddress(SID, { title: "داخلی", latitude: 35.7 }));
});

test("updateAddress can explicitly clear a previously-set location with both null", async () => {
  installSheet();
  const created = await store.createAddress(SID, VALID);
  const updated = await store.updateAddress(SID, created.id, { latitude: null, longitude: null });
  assert.equal(updated.latitude, null);
  assert.equal(updated.longitude, null);
});

// ── چند عکس (`photo_file_ids`) ──────────────────────────────────────────────

test("createAddress persists multiple photo_file_ids", async () => {
  installSheet();
  const created = await store.createAddress(SID, { title: "داخلی", photo_file_ids: ["f1", "f2", "f3"] });
  assert.deepEqual(created.photo_file_ids, ["f1", "f2", "f3"]);
});

test("photo_file_ids rejects more than 10 photos", async () => {
  installSheet();
  const many = Array.from({ length: 11 }, (_, i) => `f${i}`);
  await assert.rejects(() => store.createAddress(SID, { title: "داخلی", photo_file_ids: many }));
});

test("listAddresses/getAddress fall back to the legacy single photo_file_id for old rows", async () => {
  const tabs = installSheet();
  const created = await store.createAddress(SID, { title: "داخلی" });
  // شبیه‌سازیِ یک ردیفِ قدیمی که هنوز photo_file_ids ندارد.
  const row = tabs.get("addresses").get(created.id);
  tabs.get("addresses").set(created.id, { ...row, photo_file_id: "legacy_fid", photo_file_ids: [] });

  const fetched = await store.getAddress(SID, created.id);
  assert.deepEqual(fetched.photo_file_ids, ["legacy_fid"]);
  const listed = await store.listAddresses(SID);
  assert.deepEqual(listed.find((a) => a.id === created.id).photo_file_ids, ["legacy_fid"]);
});
