/**
 * test/giveawayStore.test.mjs — IRFORGE_PROMPT_V3 Phase 20
 *
 * Exercises lib/giveawayStore.ts against the fake `botConfig.sheetLayer` —
 * same in-memory-sheet harness as test/addressStore.test.mjs/dripStore.test.mjs.
 * Covers the entrant/winner drill-down this store exists to provide (see
 * its own header comment) and that the draw-owned fields
 * (status/winner_ids/entry_count/drawn_at/announced_at) are never
 * accepted through updateGiveaway.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
delete process.env.BOT_CACHE_DATABASE_URL;
delete process.env.BUSINESS_DATABASE_URL;

const botConfig = await import("../src/lib/botConfig.ts");
const store = await import("../src/lib/giveawayStore.ts");

const SID = "SHEET_TEST_GIVEAWAY";

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

const VALID = { title: "جشنواره تابستان", prize: "هدیه ویژه" };

// ── create / update / cancel / delete ───────────────────────────────────

test("createGiveaway starts running with zero entries and no winners", async () => {
  installSheet();
  const g = await store.createGiveaway(SID, VALID);
  assert.equal(g.status, "running");
  assert.equal(g.entry_count, 0);
  assert.deepEqual(g.winner_ids, []);
  assert.match(g.id, /^gw_[0-9a-f]{12}$/);
});

test("createGiveaway rejects a missing title or prize", async () => {
  installSheet();
  await assert.rejects(() => store.createGiveaway(SID, { ...VALID, title: "" }));
  await assert.rejects(() => store.createGiveaway(SID, { ...VALID, prize: "" }));
});

test("createGiveaway clamps winner_count to at least one", async () => {
  installSheet();
  const g = await store.createGiveaway(SID, { ...VALID, winner_count: 0 });
  assert.equal(g.winner_count, 1);
});

test("createGiveaway rejects a malformed ends_at", async () => {
  installSheet();
  await assert.rejects(() => store.createGiveaway(SID, { ...VALID, ends_at: "not-a-date" }));
});

test("updateGiveaway edits pre-draw fields only", async () => {
  installSheet();
  const g = await store.createGiveaway(SID, VALID);
  const updated = await store.updateGiveaway(SID, g.id, { title: "جشنواره پاییز", winner_count: 3 });
  assert.equal(updated.title, "جشنواره پاییز");
  assert.equal(updated.winner_count, 3);
});

test("updateGiveaway ignores draw-owned fields even if sent", async () => {
  installSheet();
  const g = await store.createGiveaway(SID, VALID);
  const updated = await store.updateGiveaway(SID, g.id, {
    status: "drawn", winner_ids: ["999"], entry_count: 500, drawn_at: "2020-01-01T00:00:00Z",
  });
  assert.equal(updated.status, "running");
  assert.deepEqual(updated.winner_ids, []);
  assert.equal(updated.entry_count, 0);
  assert.equal(updated.drawn_at, undefined);
});

test("updateGiveaway 404s on an unknown id", async () => {
  installSheet();
  await assert.rejects(() => store.updateGiveaway(SID, "gw_missing", { title: "x" }), /پیدا نشد/);
});

test("cancelGiveaway sets status to canceled", async () => {
  installSheet();
  const g = await store.createGiveaway(SID, VALID);
  const canceled = await store.cancelGiveaway(SID, g.id);
  assert.equal(canceled.status, "canceled");
});

test("deleteGiveaway removes the campaign and its entrants", async () => {
  const tabs = installSheet();
  const g = await store.createGiveaway(SID, VALID);
  tabs.set("giveaway_entries", new Map([
    ["gwe_1", { id: "gwe_1", giveaway_id: g.id, user_id: "1" }],
    ["gwe_2", { id: "gwe_2", giveaway_id: "other", user_id: "2" }],
  ]));
  assert.equal(await store.deleteGiveaway(SID, g.id), true);
  assert.equal(await store.getGiveaway(SID, g.id), null);
  assert.equal(tabs.get("giveaway_entries").has("gwe_1"), false);
  assert.equal(tabs.get("giveaway_entries").has("gwe_2"), true);
});

// ── entrants / winners drill-down ───────────────────────────────────────

test("listEntrants only returns entries for that giveaway, oldest first", async () => {
  const tabs = installSheet();
  const g = await store.createGiveaway(SID, VALID);
  tabs.set("giveaway_entries", new Map([
    ["gwe_1", { id: "gwe_1", giveaway_id: g.id, user_id: "1", username: "ali", created_at: "2026-01-01T00:00:00Z" }],
    ["gwe_2", { id: "gwe_2", giveaway_id: g.id, user_id: "2", username: "sara", created_at: "2026-01-02T00:00:00Z" }],
    ["gwe_3", { id: "gwe_3", giveaway_id: "other_gw", user_id: "3", username: "x", created_at: "2026-01-01T00:00:00Z" }],
  ]));
  const entrants = await store.listEntrants(SID, g.id);
  assert.deepEqual(entrants.map((e) => e.user_id), ["1", "2"]);
});

test("getWinners resolves winner_ids to full entrant records", async () => {
  const tabs = installSheet();
  const g = await store.createGiveaway(SID, VALID);
  tabs.set("giveaway_entries", new Map([
    ["gwe_1", { id: "gwe_1", giveaway_id: g.id, user_id: "1", username: "ali" }],
    ["gwe_2", { id: "gwe_2", giveaway_id: g.id, user_id: "2", username: "sara" }],
  ]));
  tabs.get("giveaways").set(g.id, { ...tabs.get("giveaways").get(g.id), status: "drawn", winner_ids: ["2"] });

  const winners = await store.getWinners(SID, g.id);
  assert.equal(winners.length, 1);
  assert.equal(winners[0].username, "sara");
});

test("getWinners is empty before any draw", async () => {
  installSheet();
  const g = await store.createGiveaway(SID, VALID);
  assert.deepEqual(await store.getWinners(SID, g.id), []);
});

test("getWinners skips a winner_id with no matching entrant row", async () => {
  const tabs = installSheet();
  const g = await store.createGiveaway(SID, VALID);
  tabs.get("giveaways").set(g.id, { ...tabs.get("giveaways").get(g.id), winner_ids: ["999"] });
  assert.deepEqual(await store.getWinners(SID, g.id), []);
});

// ── stats ────────────────────────────────────────────────────────────────

test("getStats counts total, running (respecting ends_at), drawn, and entries", async () => {
  const tabs = installSheet();
  const running = await store.createGiveaway(SID, { ...VALID, title: "در جریان" });
  const expired = await store.createGiveaway(SID, {
    ...VALID, title: "تمام‌شده", ends_at: "2020-01-01T00:00:00Z",
  });
  const drawn = await store.createGiveaway(SID, { ...VALID, title: "قرعه‌کشی‌شده" });
  tabs.get("giveaways").set(drawn.id, { ...tabs.get("giveaways").get(drawn.id), status: "drawn" });
  tabs.set("giveaway_entries", new Map([["gwe_1", { giveaway_id: running.id, user_id: "1" }]]));

  const stats = await store.getStats(SID);
  assert.equal(stats.total, 3);
  assert.equal(stats.running, 1);
  assert.equal(stats.drawn, 1);
  assert.equal(stats.entries, 1);
});
