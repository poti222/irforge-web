/**
 * test/crmStore.test.mjs — IRFORGE_PROMPT_V3 Phase 20
 *
 * Exercises lib/crmStore.ts against the fake `botConfig.sheetLayer` — same
 * in-memory-sheet harness as test/addressStore.test.mjs/dripStore.test.mjs.
 * The composite-key assignment (idempotent re-assign, no duplicates) is the
 * core behavior this store exists to provide — see the module's own header
 * comment for why the generic collection system couldn't do this.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
delete process.env.BOT_CACHE_DATABASE_URL;
delete process.env.BUSINESS_DATABASE_URL;

const botConfig = await import("../src/lib/botConfig.ts");
const store = await import("../src/lib/crmStore.ts");

const SID = "SHEET_TEST_CRM";

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

// ── tags ─────────────────────────────────────────────────────────────────

test("createTag persists with a default emoji", async () => {
  installSheet();
  const tag = await store.createTag(SID, { name: "VIP" });
  assert.match(tag.id, /^tag_[0-9a-f]{12}$/);
  assert.equal(tag.emoji, "🏷");
});

test("createTag rejects an empty name", async () => {
  installSheet();
  await assert.rejects(() => store.createTag(SID, { name: "   " }));
});

test("createTag rejects a case-insensitive duplicate name", async () => {
  installSheet();
  await store.createTag(SID, { name: "VIP" });
  await assert.rejects(() => store.createTag(SID, { name: "vip" }));
});

test("createTag enforces the max tags cap", async () => {
  installSheet();
  for (let i = 0; i < store.MAX_TAGS; i++) await store.createTag(SID, { name: `tag ${i}` });
  await assert.rejects(() => store.createTag(SID, { name: "one more" }));
});

test("listTags sorts by name", async () => {
  installSheet();
  await store.createTag(SID, { name: "ب" });
  await store.createTag(SID, { name: "الف" });
  const names = (await store.listTags(SID)).map((t) => t.name);
  assert.deepEqual(names, ["الف", "ب"]);
});

test("updateTag renames and rejects a rename onto an existing name", async () => {
  installSheet();
  const a = await store.createTag(SID, { name: "الف" });
  await store.createTag(SID, { name: "ب" });
  const renamed = await store.updateTag(SID, a.id, { name: "الف نو" });
  assert.equal(renamed.name, "الف نو");
  await assert.rejects(() => store.updateTag(SID, a.id, { name: "ب" }));
});

test("deleteTag also removes its assignments", async () => {
  installSheet();
  const tag = await store.createTag(SID, { name: "VIP" });
  await store.assignTag(SID, "1", tag.id, "admin");
  assert.equal(await store.deleteTag(SID, tag.id), true);
  assert.equal((await store.usersWithTag(SID, tag.id)).length, 0);
});

// ── assignment — the composite key is the whole point ──────────────────────

test("assignTag rejects an unknown tag", async () => {
  installSheet();
  await assert.rejects(() => store.assignTag(SID, "1", "tag_missing", "admin"));
});

test("assignTag uses a deterministic composite key", async () => {
  installSheet();
  const tag = await store.createTag(SID, { name: "VIP" });
  const link = await store.assignTag(SID, "1", tag.id, "admin");
  assert.equal(link.id, `1:${tag.id}`);
});

test("re-assigning the same tag overwrites instead of duplicating", async () => {
  const tabs = installSheet();
  const tag = await store.createTag(SID, { name: "VIP" });
  await store.assignTag(SID, "1", tag.id, "admin_a");
  await store.assignTag(SID, "1", tag.id, "admin_b");
  assert.equal(tabs.get("crm_user_tags").size, 1);
  const link = tabs.get("crm_user_tags").get(`1:${tag.id}`);
  assert.equal(link.assigned_by, "admin_b");
});

test("unassignTag removes the link", async () => {
  installSheet();
  const tag = await store.createTag(SID, { name: "VIP" });
  await store.assignTag(SID, "1", tag.id, "admin");
  assert.equal(await store.unassignTag(SID, "1", tag.id), true);
  assert.deepEqual(await store.tagsOfUser(SID, "1"), []);
});

test("tagsOfUser returns full tag records sorted by name", async () => {
  installSheet();
  const vip = await store.createTag(SID, { name: "VIP" });
  const lead = await store.createTag(SID, { name: "Lead" });
  await store.assignTag(SID, "1", vip.id, "admin");
  await store.assignTag(SID, "1", lead.id, "admin");
  const names = (await store.tagsOfUser(SID, "1")).map((t) => t.name);
  assert.deepEqual(names, ["Lead", "VIP"]);
});

test("usersWithTag is exactly drip's segment audience query", async () => {
  installSheet();
  const tag = await store.createTag(SID, { name: "VIP" });
  await store.assignTag(SID, "1", tag.id, "admin");
  await store.assignTag(SID, "2", tag.id, "admin");
  assert.deepEqual((await store.usersWithTag(SID, tag.id)).sort(), ["1", "2"]);
});

test("tagCounts reflects assignment totals per tag", async () => {
  installSheet();
  const vip = await store.createTag(SID, { name: "VIP" });
  const lead = await store.createTag(SID, { name: "Lead" });
  await store.assignTag(SID, "1", vip.id, "admin");
  await store.assignTag(SID, "2", vip.id, "admin");
  await store.assignTag(SID, "1", lead.id, "admin");
  const counts = await store.tagCounts(SID);
  assert.equal(counts[vip.id], 2);
  assert.equal(counts[lead.id], 1);
});

// ── notes ────────────────────────────────────────────────────────────────

test("addNote persists body and author", async () => {
  installSheet();
  const note = await store.addNote(SID, "1", "پیگیری شد", "admin_a");
  assert.equal(note.body, "پیگیری شد");
  assert.match(note.id, /^note_[0-9a-f]{12}$/);
});

test("addNote rejects an empty body", async () => {
  installSheet();
  await assert.rejects(() => store.addNote(SID, "1", "   ", "admin_a"));
});

test("notesOfUser returns only that user's own notes", async () => {
  installSheet();
  const first = await store.addNote(SID, "1", "اول", "a");
  await store.addNote(SID, "2", "برای دیگری", "a");
  const second = await store.addNote(SID, "1", "دوم", "a");
  const notes = await store.notesOfUser(SID, "1");
  assert.deepEqual(new Set(notes.map((n) => n.id)), new Set([first.id, second.id]));
});

test("deleteNote removes it", async () => {
  installSheet();
  const note = await store.addNote(SID, "1", "x", "a");
  assert.equal(await store.deleteNote(SID, note.id), true);
  assert.deepEqual(await store.notesOfUser(SID, "1"), []);
});

// ── stats ────────────────────────────────────────────────────────────────

test("getStats counts tags, tagged users, assignments, and notes", async () => {
  installSheet();
  const vip = await store.createTag(SID, { name: "VIP" });
  const lead = await store.createTag(SID, { name: "Lead" });
  await store.assignTag(SID, "1", vip.id, "a");
  await store.assignTag(SID, "1", lead.id, "a");
  await store.assignTag(SID, "2", vip.id, "a");
  await store.addNote(SID, "1", "x", "a");

  const stats = await store.getStats(SID);
  assert.equal(stats.tags, 2);
  assert.equal(stats.taggedUsers, 2);
  assert.equal(stats.assignments, 3);
  assert.equal(stats.notes, 1);
});
