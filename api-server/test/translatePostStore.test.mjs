/**
 * test/translatePostStore.test.mjs
 *
 * Exercises lib/translatePostStore.ts against the fake `botConfig.sheetLayer`
 * — same in-memory-sheet harness as test/giveawayStore.test.mjs. Covers the
 * sheet-only surface (config get/set, post listing) plus the isolated
 * Google Translate network call via a stubbed `translatePostLayer.translate`
 * seam, mirroring the bot's own `_call_provider` isolation convention
 * (plugins/translate_post/handlers.py) so no test ever touches the real
 * network. `publishPost`'s bot-identity lookup (real Postgres `botsTable`)
 * is intentionally not unit-tested here — same boundary the codebase already
 * draws for routes/botBroadcast.ts's identical `botToken()` lookup.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
delete process.env.BOT_CACHE_DATABASE_URL;
delete process.env.BUSINESS_DATABASE_URL;

const botConfig = await import("../src/lib/botConfig.ts");
const store = await import("../src/lib/translatePostStore.ts");

const SID = "SHEET_TEST_TRANSLATE_POST";

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

// ── config ───────────────────────────────────────────────────────────────

test("getConfig defaults to unconfigured with fa as the source language", async () => {
  installSheet();
  const config = await store.getConfig(SID);
  assert.equal(config.channelId, "");
  assert.equal(config.hasApiKey, false);
  assert.equal(config.sourceLang, "fa");
  assert.equal(config.enabled, false);
  assert.equal(config.configured, false);
});

test("updateConfig sets channel + key and masks the key, never echoing it raw", async () => {
  installSheet();
  const config = await store.updateConfig(SID, { channelId: "@ancient_iran", apiKey: "AIzaSyTestKeyValue1234" });
  assert.equal(config.channelId, "@ancient_iran");
  assert.equal(config.hasApiKey, true);
  assert.equal(config.configured, true);
  assert.ok(!config.apiKeyMasked.includes("TestKeyValue"));
  assert.match(config.apiKeyMasked, /^AIza.*1234$/);
});

test("updateConfig leaves an unspecified field untouched", async () => {
  installSheet();
  await store.updateConfig(SID, { channelId: "@a", apiKey: "key12345678" });
  const config = await store.updateConfig(SID, { enabled: true });
  assert.equal(config.channelId, "@a");
  assert.equal(config.hasApiKey, true);
  assert.equal(config.enabled, true);
});

test("updateConfig rejects explicitly blanking the channel or key", async () => {
  installSheet();
  await assert.rejects(() => store.updateConfig(SID, { channelId: "   " }));
  await assert.rejects(() => store.updateConfig(SID, { apiKey: "" }));
});

// ── posts ────────────────────────────────────────────────────────────────

test("listPosts sorts newest first and maps translation keys to a language list", async () => {
  installSheet({
    translate_post_posts: {
      tp_aaa: {
        id: "tp_aaa", source_text: "قدیمی", source_lang: "fa",
        translations: { fa: "قدیمی", en: "old" }, channel_message_id: 10, created_at: "2026-01-01T00:00:00+00:00",
      },
      tp_bbb: {
        id: "tp_bbb", source_text: "جدید", source_lang: "fa",
        translations: { fa: "جدید", en: "new", ar: "جديد" }, channel_message_id: 11, created_at: "2026-06-01T00:00:00+00:00",
      },
    },
  });
  const posts = await store.listPosts(SID);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].id, "tp_bbb");
  assert.deepEqual(posts[0].languages.sort(), ["ar", "en", "fa"]);
  assert.equal(posts[1].id, "tp_aaa");
});

test("listPosts respects the limit", async () => {
  installSheet({
    translate_post_posts: {
      tp_a: { id: "tp_a", source_text: "x", translations: { fa: "x" }, created_at: "2026-01-01T00:00:00+00:00" },
      tp_b: { id: "tp_b", source_text: "y", translations: { fa: "y" }, created_at: "2026-01-02T00:00:00+00:00" },
      tp_c: { id: "tp_c", source_text: "z", translations: { fa: "z" }, created_at: "2026-01-03T00:00:00+00:00" },
    },
  });
  const posts = await store.listPosts(SID, 2);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].id, "tp_c");
});

// ── Google Translate seam ───────────────────────────────────────────────

test("translatePostLayer.translate parses a successful Google Translate v2 response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { translations: [{ translatedText: "Hello" }] } }),
  });
  try {
    const result = await store.translatePostLayer.translate("fake-key", "سلام", "en", "fa");
    assert.equal(result, "Hello");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("translatePostLayer.translate throws on a non-ok response instead of returning garbage", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: { message: "API key not valid" } }),
  });
  try {
    await assert.rejects(
      () => store.translatePostLayer.translate("bad-key", "سلام", "en", "fa"),
      /API key not valid/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
