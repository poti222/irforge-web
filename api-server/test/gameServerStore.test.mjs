/**
 * test/gameServerStore.test.mjs — IRFORGE_CS2_RCON_PLUGIN_PROMPT Phase 3
 *
 * Exercises lib/gameServerStore.ts against the fake `botConfig.sheetLayer` —
 * same in-memory-sheet harness as test/addressStore.test.mjs. The two things
 * that matter most here, beyond ordinary CRUD: rcon_password is genuinely
 * never returned from any function (only `hasRconPassword: boolean` is),
 * and it round-trips through the SAME AES-256-GCM scheme the bot's Python
 * side uses (registry_token_crypto.py) via tokenCrypto.ts.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
process.env.BOT_TOKEN_ENCRYPTION_KEY ??= "c".repeat(64);
delete process.env.BOT_CACHE_DATABASE_URL;
delete process.env.BUSINESS_DATABASE_URL;

const botConfig = await import("../src/lib/botConfig.ts");
const store = await import("../src/lib/gameServerStore.ts");
const { decryptToken } = await import("../src/lib/tokenCrypto.ts");

const SID = "SHEET_TEST_GAMESERVER";

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

const VALID = { label: "سرور اصلی", host: "1.2.3.4", port: 27015, rconPassword: "hunter2" };

test("createServer persists a valid server and never returns the password", async () => {
  installSheet();
  const created = await store.createServer(SID, VALID);
  assert.match(created.id, /^gs_[0-9a-f]{12}$/);
  assert.equal(created.label, "سرور اصلی");
  assert.equal(created.host, "1.2.3.4");
  assert.equal(created.port, 27015);
  assert.equal(created.hasRconPassword, true);
  assert.equal(created.is_active, true);
  assert.equal("rconPassword" in created, false);
  assert.equal("rcon_password" in created, false);
});

test("createServer stores the password AES-256-GCM encrypted, decryptable via tokenCrypto", async () => {
  const tabs = installSheet();
  const created = await store.createServer(SID, VALID);
  const raw = tabs.get("gameserver_cs2_servers").get(created.id);
  assert.notEqual(raw.rcon_password, "hunter2");
  assert.match(raw.rcon_password, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  assert.equal(decryptToken(raw.rcon_password), "hunter2");
});

test("createServer rejects a missing label", async () => {
  installSheet();
  await assert.rejects(() => store.createServer(SID, { ...VALID, label: "" }));
});

test("createServer rejects a missing host", async () => {
  installSheet();
  await assert.rejects(() => store.createServer(SID, { ...VALID, host: "" }));
});

test("createServer rejects an out-of-range port", async () => {
  installSheet();
  await assert.rejects(() => store.createServer(SID, { ...VALID, port: 70000 }));
  await assert.rejects(() => store.createServer(SID, { ...VALID, port: 0 }));
});

test("createServer rejects a missing rconPassword", async () => {
  installSheet();
  await assert.rejects(() => store.createServer(SID, { ...VALID, rconPassword: "" }));
  const { rconPassword, ...withoutPassword } = VALID;
  await assert.rejects(() => store.createServer(SID, withoutPassword));
});

test("listServers returns everything sorted by label, never a password field", async () => {
  installSheet();
  await store.createServer(SID, { ...VALID, label: "سرور ب" });
  await store.createServer(SID, { ...VALID, label: "سرور الف" });
  const rows = await store.listServers(SID);
  assert.deepEqual(rows.map((r) => r.label), ["سرور الف", "سرور ب"]);
  assert.ok(rows.every((r) => !("rconPassword" in r) && !("rcon_password" in r)));
});

test("updateServer applies a partial change without touching the password", async () => {
  const tabs = installSheet();
  const created = await store.createServer(SID, VALID);
  const before = tabs.get("gameserver_cs2_servers").get(created.id).rcon_password;

  const updated = await store.updateServer(SID, created.id, { label: "نام تازه" });
  assert.equal(updated.label, "نام تازه");
  assert.equal(updated.host, VALID.host); // untouched fields survive a partial update
  assert.equal(updated.hasRconPassword, true);

  const after = tabs.get("gameserver_cs2_servers").get(created.id).rcon_password;
  assert.equal(after, before); // the password itself was never rewritten
});

test("updateServer with a new rconPassword re-encrypts it", async () => {
  const tabs = installSheet();
  const created = await store.createServer(SID, VALID);
  await store.updateServer(SID, created.id, { rconPassword: "newpass" });
  const raw = tabs.get("gameserver_cs2_servers").get(created.id);
  assert.equal(decryptToken(raw.rcon_password), "newpass");
});

test("updateServer can toggle is_active", async () => {
  installSheet();
  const created = await store.createServer(SID, VALID);
  const updated = await store.updateServer(SID, created.id, { is_active: false });
  assert.equal(updated.is_active, false);
  const reactivated = await store.updateServer(SID, created.id, { is_active: true });
  assert.equal(reactivated.is_active, true);
});

test("updateServer 404s on an unknown id", async () => {
  installSheet();
  await assert.rejects(() => store.updateServer(SID, "gs_missing", { label: "x" }), /پیدا نشد/);
});

test("updateServer rejects an invalid port even on a partial update", async () => {
  installSheet();
  const created = await store.createServer(SID, VALID);
  await assert.rejects(() => store.updateServer(SID, created.id, { port: 999999 }));
});

test("deleteServer removes it", async () => {
  installSheet();
  const created = await store.createServer(SID, VALID);
  assert.equal(await store.deleteServer(SID, created.id), true);
  assert.deepEqual(await store.listServers(SID), []);
});

test("deleteServer on an unknown id returns false, does not throw", async () => {
  installSheet();
  assert.equal(await store.deleteServer(SID, "gs_missing"), false);
});

test("creating a server does not disturb other tabs", async () => {
  const tabs = installSheet({ bot_settings: { reply_keyboard: { rows: [["/shop"]] } } });
  await store.createServer(SID, VALID);
  assert.deepEqual(tabs.get("bot_settings").get("reply_keyboard"), { rows: [["/shop"]] });
});
