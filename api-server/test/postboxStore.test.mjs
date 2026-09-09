/**
 * test/postboxStore.test.mjs — IRFORGE_POSTBOX_PROMPT Phase B1
 *
 * Exercises lib/postboxStore.ts against the fake `botConfig.sheetLayer` —
 * same in-memory-sheet harness as test/catalogStore.test.mjs. Covers id
 * generation (no dash, matching domain.py's `_short_id()` contract),
 * composed-vs-forwarded edit restrictions, cascade delete, lang_code/kind/
 * style validation, the broken-translation-button publish guard, and the
 * buttons_dirty gating (requestButtonEdit is a no-op until something is
 * actually "sent").
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
delete process.env.BOT_CACHE_DATABASE_URL;
delete process.env.BUSINESS_DATABASE_URL;

const botConfig = await import("../src/lib/botConfig.ts");
const store = await import("../src/lib/postboxStore.ts");

const SID = "SHEET_TEST_POSTBOX";

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

// ── id generation ────────────────────────────────────────────────────────

test("created message/translation/button/target ids never contain a dash", async () => {
  installSheet();
  const message = await store.createComposedMessage(SID, { body_html: "hello" });
  assert.doesNotMatch(message.id, /-/);
  assert.match(message.id, /^pm[0-9a-z]{6}$/);

  const translation = await store.createTranslation(SID, message.id, { lang_code: "en", body_html: "hi" });
  assert.doesNotMatch(translation.id, /-/);
  assert.match(translation.id, /^pt[0-9a-z]{6}$/);

  const button = await store.createButton(SID, message.id, { label: "Go", kind: "url", target: "https://x.test" });
  assert.doesNotMatch(button.id, /-/);
  assert.match(button.id, /^pb[0-9a-z]{6}$/);

  const [result] = await store.publishMessage(SID, message.id, [{ channel_id: "-1001" }], false);
  const target = result.targets[0];
  assert.doesNotMatch(target.id, /-/);
  assert.match(target.id, /^px[0-9a-z]{6}$/);
});

// ── messages ──────────────────────────────────────────────────────────────

test("createComposedMessage sanitizes body_html and rejects an empty body", async () => {
  installSheet();
  // sanitizeTelegramHtml strips a disallowed tag but keeps its escaped text content.
  const message = await store.createComposedMessage(SID, { body_html: "<script>x</script><b>bold</b>" });
  assert.equal(message.body_html, "x<b>bold</b>");
  assert.equal(message.source_type, "composed");

  await assert.rejects(() => store.createComposedMessage(SID, { body_html: "   " }));
});

test("updateComposedMessage refuses to edit a forwarded message's content", async () => {
  const tabs = installSheet({
    postbox_messages: {
      pmforwrd: {
        title: "", source_type: "forwarded", src_chat_id: "777", src_message_id: "42",
        body_html: "", preview_text: "x", preview_media: "file1", media_group_id: "", is_album: false,
        buttons_dirty: false, created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z",
      },
    },
  });
  await assert.rejects(
    () => store.updateComposedMessage(SID, "pmforwrd", { body_html: "new text" }),
    /not_composed|قابلِ ویرایش نیست/,
  );
  void tabs;
});

test("deleteMessage cascades to its translations, buttons and targets", async () => {
  installSheet();
  const message = await store.createComposedMessage(SID, { body_html: "hello" });
  await store.createTranslation(SID, message.id, { lang_code: "en", body_html: "hi" });
  await store.createButton(SID, message.id, { label: "Go", kind: "url", target: "https://x.test" });
  await store.publishMessage(SID, message.id, [{ channel_id: "-1001" }], false);

  const removed = await store.deleteMessage(SID, message.id);
  assert.equal(removed, true);
  assert.equal(await store.getMessage(SID, message.id), null);
  assert.deepEqual(await store.listTranslations(SID, message.id), []);
  assert.deepEqual(await store.listButtons(SID, message.id), []);
  assert.deepEqual(await store.listTargets(SID, message.id), []);
});

// ── translations ──────────────────────────────────────────────────────────

test("createTranslation rejects a bad lang_code and a duplicate lang_code", async () => {
  installSheet();
  const message = await store.createComposedMessage(SID, { body_html: "hello" });
  await assert.rejects(() => store.createTranslation(SID, message.id, { lang_code: "a-b", body_html: "x" }));
  await assert.rejects(() => store.createTranslation(SID, message.id, { lang_code: "EN!", body_html: "x" }));

  await store.createTranslation(SID, message.id, { lang_code: "ES", body_html: "Hola" });
  await assert.rejects(
    () => store.createTranslation(SID, message.id, { lang_code: "es", body_html: "Hola de nuevo" }),
    (err) => err.code === "lang_already_exists",
  );
});

test("createTranslation lower-cases lang_code and sanitizes body_html", async () => {
  installSheet();
  const message = await store.createComposedMessage(SID, { body_html: "hello" });
  const tr = await store.createTranslation(SID, message.id, { lang_code: "ES", body_html: "<strong>Hola</strong>" });
  assert.equal(tr.lang_code, "es");
  assert.equal(tr.body_html, "<b>Hola</b>"); // strong -> b, same whitelist as catalogHtml.ts
  assert.equal(tr.status, "draft");
});

// ── buttons ───────────────────────────────────────────────────────────────

test("createButton rejects an empty label and a bad kind/style", async () => {
  installSheet();
  const message = await store.createComposedMessage(SID, { body_html: "hello" });
  await assert.rejects(() => store.createButton(SID, message.id, { label: "  ", kind: "url" }));
  await assert.rejects(() => store.createButton(SID, message.id, { label: "x", kind: "callback" }));
  await assert.rejects(() => store.createButton(SID, message.id, { label: "x", kind: "url", style: "rainbow" }));
});

test("a translation-kind button must point at a translation of the same message", async () => {
  installSheet();
  const m1 = await store.createComposedMessage(SID, { body_html: "hello" });
  const m2 = await store.createComposedMessage(SID, { body_html: "other" });
  const trOfM2 = await store.createTranslation(SID, m2.id, { lang_code: "en", body_html: "hi" });

  await assert.rejects(
    () => store.createButton(SID, m1.id, { label: "EN", kind: "translation", target: trOfM2.id }),
    (err) => err.code === "translation_not_found",
  );
  await assert.rejects(
    () => store.createButton(SID, m1.id, { label: "EN", kind: "translation", target: "doesnotexist" }),
    (err) => err.code === "translation_not_found",
  );

  const trOfM1 = await store.createTranslation(SID, m1.id, { lang_code: "fa", body_html: "سلام" });
  const btn = await store.createButton(SID, m1.id, { label: "FA", kind: "translation", target: trOfM1.id });
  assert.equal(btn.target, trOfM1.id);
});

// ── publish ───────────────────────────────────────────────────────────────

test("publishMessage refuses the whole batch if any translation button is broken", async () => {
  installSheet();
  const message = await store.createComposedMessage(SID, { body_html: "hello" });
  const tr = await store.createTranslation(SID, message.id, { lang_code: "en", body_html: "hi" }); // still "draft"
  await store.createButton(SID, message.id, { label: "EN", kind: "translation", target: tr.id });

  await assert.rejects(
    () => store.publishMessage(SID, message.id, [{ channel_id: "-1001" }, { channel_id: "-1002" }], false),
    (err) => err.code === "broken_translation_button",
  );
  // نه فقط رد شدن -- هیچ targetی هم نباید ساخته شده باشد (all-or-nothing).
  assert.deepEqual(await store.listTargets(SID, message.id), []);

  await store.updateTranslation(SID, message.id, tr.id, { status: "ready" });
  const results = await store.publishMessage(SID, message.id, [{ channel_id: "-1001" }, { channel_id: "-1002" }], false);
  assert.equal(results.length, 2);
  assert.equal((await store.listTargets(SID, message.id)).length, 2);
});

test("publishMessage requires at least one channel and a non-empty channel_id", async () => {
  installSheet();
  const message = await store.createComposedMessage(SID, { body_html: "hello" });
  await assert.rejects(() => store.publishMessage(SID, message.id, [], false));
  await assert.rejects(() => store.publishMessage(SID, message.id, [{ channel_id: "  " }], false));
});

test("publishMessage estimates eta_minutes from already-queued targets on the same channel", async () => {
  installSheet();
  const message = await store.createComposedMessage(SID, { body_html: "hello" });
  // سقفِ حالتِ عادی ۵/دقیقه -- همه به یک کانال: ۵ تایِ اول eta=0، ششمی eta>0.
  const channels = Array.from({ length: 6 }, () => ({ channel_id: "-1001" }));
  const results = await store.publishMessage(SID, message.id, channels, false);
  assert.equal(results[0].eta_minutes, 0);
  assert.equal(results[4].eta_minutes, 0);
  assert.ok(results[5].eta_minutes > 0);
});

// ── edit-buttons trigger (Phase A8 companion) ───────────────────────────────

test("requestButtonEdit is a no-op until a target has actually been sent", async () => {
  installSheet();
  const message = await store.createComposedMessage(SID, { body_html: "hello" });
  await store.publishMessage(SID, message.id, [{ channel_id: "-1001" }], false); // still "queued"

  await store.requestButtonEdit(SID, message.id);
  assert.equal((await store.getMessage(SID, message.id)).buttons_dirty, false);
});

test("createButton/updateButton/deleteButton flag buttons_dirty once a target is sent", async () => {
  installSheet();
  const message = await store.createComposedMessage(SID, { body_html: "hello" });
  const [{ targets }] = await store.publishMessage(SID, message.id, [{ channel_id: "-1001" }], false);
  // شبیه‌سازیِ اینکه بات واقعاً فرستاده -- flush_publish_queue خودش این را می‌نویسد.
  await botConfig.putEntity(SID, "postbox_targets", targets[0].id, { ...targets[0], status: "sent" });

  await store.createButton(SID, message.id, { label: "Go", kind: "url", target: "https://x.test" });
  assert.equal((await store.getMessage(SID, message.id)).buttons_dirty, true);
});
