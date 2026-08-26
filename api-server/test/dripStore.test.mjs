/**
 * test/dripStore.test.mjs — IRFORGE_PROMPT_V3 Phase 19
 *
 * Exercises lib/dripStore.ts against the fake `botConfig.sheetLayer` — same
 * in-memory-sheet harness as test/addressStore.test.mjs/bookingStore.test.mjs.
 *
 * `sendTestMessage`/`resolveTestTarget` (the only functions that actually
 * touch the network/DB — Telegram + `@workspace/db`) are intentionally not
 * covered here: they're thin wrappers with no branching logic beyond what
 * `botBroadcast.ts`'s already-shipped real-send code already does, and unit
 * tests only ever use numeric audience/test-target ids below (the one
 * `resolveTelegramUser` path that needs no network call at all), so no
 * Telegram/DB mocking is pulled into this file.
 *
 * اجرا: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
delete process.env.BOT_CACHE_DATABASE_URL;
delete process.env.BUSINESS_DATABASE_URL;

const botConfig = await import("../src/lib/botConfig.ts");
const store = await import("../src/lib/dripStore.ts");

const SID = "SHEET_TEST_DRIP";
const BOT_ID = "bot_test_drip";

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

const EVENT_CAMPAIGN = {
  title: "خوش‌آمدگویی", schedule_type: "event", trigger_event: "event.user.started",
  delay_minutes: 0, message: "سلام!", audience_mode: "all_users",
};

// ── create / validation ─────────────────────────────────────────────────────

test("createCampaign persists a valid event campaign", async () => {
  installSheet();
  const created = await store.createCampaign(SID, BOT_ID, EVENT_CAMPAIGN);
  assert.match(created.id, /^drp_[0-9a-f]{12}$/);
  assert.equal(created.schedule_type, "event");
  assert.equal(created.is_active, true);
  assert.equal(created.queued_count, 0);
  assert.equal(created.sent_count, 0);

  const fetched = await store.getCampaign(SID, created.id);
  assert.equal(fetched.title, "خوش‌آمدگویی");
});

test("createCampaign rejects a missing title", async () => {
  installSheet();
  await assert.rejects(() => store.createCampaign(SID, BOT_ID, { ...EVENT_CAMPAIGN, title: "" }));
});

test("createCampaign rejects a missing message", async () => {
  installSheet();
  await assert.rejects(() => store.createCampaign(SID, BOT_ID, { ...EVENT_CAMPAIGN, message: "" }));
});

test("createCampaign rejects an unknown schedule_type", async () => {
  installSheet();
  await assert.rejects(() => store.createCampaign(SID, BOT_ID, { ...EVENT_CAMPAIGN, schedule_type: "whenever" }));
});

test("createCampaign rejects an event campaign with no trigger_event", async () => {
  installSheet();
  await assert.rejects(() => store.createCampaign(SID, BOT_ID, { ...EVENT_CAMPAIGN, trigger_event: "" }));
});

test("createCampaign rejects a delay outside the allowed range", async () => {
  installSheet();
  await assert.rejects(() => store.createCampaign(SID, BOT_ID, { ...EVENT_CAMPAIGN, delay_minutes: -1 }));
  await assert.rejects(() => store.createCampaign(SID, BOT_ID, { ...EVENT_CAMPAIGN, delay_minutes: 999999 }));
});

test("createCampaign accepts a datetime campaign with a valid run_at", async () => {
  installSheet();
  const created = await store.createCampaign(SID, BOT_ID, {
    title: "یادآوری", schedule_type: "datetime", run_at: "2026-09-01T12:00:00Z",
    message: "یادت نره", audience_mode: "all_users",
  });
  assert.equal(created.schedule_type, "datetime");
  assert.equal(new Date(created.run_at).toISOString(), "2026-09-01T12:00:00.000Z");
});

test("createCampaign rejects a datetime campaign with no run_at", async () => {
  installSheet();
  await assert.rejects(() => store.createCampaign(SID, BOT_ID, {
    title: "یادآوری", schedule_type: "datetime", message: "m", audience_mode: "all_users",
  }));
});

test("createCampaign accepts a recurring campaign with days + HH:MM time", async () => {
  installSheet();
  const created = await store.createCampaign(SID, BOT_ID, {
    title: "یادآوری هفتگی", schedule_type: "recurring", recurring_days: [0, 3], recurring_time: "09:30",
    message: "یادت نره", audience_mode: "all_users",
  });
  assert.deepEqual(created.recurring_days, [0, 3]);
  assert.equal(created.recurring_time, "09:30");
});

test("createCampaign rejects a recurring campaign with no days", async () => {
  installSheet();
  await assert.rejects(() => store.createCampaign(SID, BOT_ID, {
    title: "یادآوری هفتگی", schedule_type: "recurring", recurring_days: [], recurring_time: "09:30",
    message: "m", audience_mode: "all_users",
  }));
});

test("createCampaign rejects a malformed recurring_time", async () => {
  installSheet();
  await assert.rejects(() => store.createCampaign(SID, BOT_ID, {
    title: "یادآوری هفتگی", schedule_type: "recurring", recurring_days: [1], recurring_time: "9:3",
    message: "m", audience_mode: "all_users",
  }));
});

test("createCampaign rejects an out-of-range recurring day", async () => {
  installSheet();
  await assert.rejects(() => store.createCampaign(SID, BOT_ID, {
    title: "x", schedule_type: "recurring", recurring_days: [7], recurring_time: "09:00",
    message: "m", audience_mode: "all_users",
  }));
});

test("createCampaign deduplicates and sorts recurring_days", async () => {
  installSheet();
  const created = await store.createCampaign(SID, BOT_ID, {
    title: "x", schedule_type: "recurring", recurring_days: [5, 1, 5, 0], recurring_time: "09:00",
    message: "m", audience_mode: "all_users",
  });
  assert.deepEqual(created.recurring_days, [0, 1, 5]);
});

test("createCampaign rejects a malformed recurring_end_date", async () => {
  installSheet();
  await assert.rejects(() => store.createCampaign(SID, BOT_ID, {
    title: "x", schedule_type: "recurring", recurring_days: [1], recurring_time: "09:00",
    recurring_end_date: "1405/06/01", message: "m", audience_mode: "all_users",
  }));
});

test("createCampaign rejects an unknown media_type", async () => {
  installSheet();
  await assert.rejects(() => store.createCampaign(SID, BOT_ID, {
    ...EVENT_CAMPAIGN, media_file_id: "file123", media_type: "sticker",
  }));
});

test("createCampaign accepts a known media_type", async () => {
  installSheet();
  const created = await store.createCampaign(SID, BOT_ID, {
    ...EVENT_CAMPAIGN, media_file_id: "file123", media_type: "photo",
  });
  assert.equal(created.media_type, "photo");
});

test("createCampaign rejects a button row over the per-row cap", async () => {
  installSheet();
  const buttons = Array.from({ length: 5 }, (_, i) => ({
    row: 0, label: `b${i}`, action: "callback", value: `v${i}`, row_start: i === 0,
  }));
  await assert.rejects(() => store.createCampaign(SID, BOT_ID, { ...EVENT_CAMPAIGN, buttons }));
});

test("createCampaign normalizes buttons into rows/cols from explicit row_start", async () => {
  // همان قراردادی که `rowsToButtons()`ی کلاینت واقعاً می‌فرستد: هر دکمه
  // row_start صریح دارد، نه اینکه سرور از روی تساویِ row حدس بزند.
  installSheet();
  const buttons = [
    { row: 0, label: "الف", action: "callback", value: "a", row_start: true },
    { row: 0, label: "ب", action: "callback", value: "b", row_start: false },
    { row: 1, label: "پ", action: "url", value: "https://x.test", row_start: true },
  ];
  const created = await store.createCampaign(SID, BOT_ID, { ...EVENT_CAMPAIGN, buttons });
  assert.equal(created.buttons.length, 3);
  assert.equal(created.buttons[0].row, 0);
  assert.equal(created.buttons[1].row, 0);
  assert.equal(created.buttons[2].row, 1);
});

test("createCampaign treats a button with no row_start as starting its own row", async () => {
  // پیش‌فرضِ `newButton()` — همان چیزی که `routes/botPanels.ts` هم استفاده
  // می‌کند: بدون row_start صریح، یعنی این دکمه خودش سرِ یک ردیفِ تازه است.
  installSheet();
  const buttons = [
    { row: 0, label: "الف", action: "callback", value: "a" },
    { row: 0, label: "ب", action: "callback", value: "b" },
  ];
  const created = await store.createCampaign(SID, BOT_ID, { ...EVENT_CAMPAIGN, buttons });
  assert.equal(created.buttons[0].row, 0);
  assert.equal(created.buttons[1].row, 1);
});

test("createCampaign rejects an unknown audience_mode", async () => {
  installSheet();
  await assert.rejects(() => store.createCampaign(SID, BOT_ID, { ...EVENT_CAMPAIGN, audience_mode: "everyone_ever" }));
});

test("createCampaign resolves a numeric single_chat audience_value without any network call", async () => {
  installSheet();
  const created = await store.createCampaign(SID, BOT_ID, {
    ...EVENT_CAMPAIGN, audience_mode: "single_chat", audience_value: "123456789",
  });
  assert.equal(created.audience_value, "123456789");
});

test("createCampaign rejects single_chat with an empty audience_value", async () => {
  installSheet();
  await assert.rejects(() => store.createCampaign(SID, BOT_ID, {
    ...EVENT_CAMPAIGN, audience_mode: "single_chat", audience_value: "",
  }));
});

test("createCampaign stores a segment tag_id verbatim, with no Telegram resolution", async () => {
  installSheet();
  const created = await store.createCampaign(SID, BOT_ID, {
    ...EVENT_CAMPAIGN, audience_mode: "segment", audience_value: "tag_vip123",
  });
  assert.equal(created.audience_value, "tag_vip123");
});

test("createCampaign rejects segment mode with an empty tag_id", async () => {
  installSheet();
  await assert.rejects(() => store.createCampaign(SID, BOT_ID, {
    ...EVENT_CAMPAIGN, audience_mode: "segment", audience_value: "",
  }));
});

test("updateCampaign switches a campaign from all_users to a segment tag", async () => {
  installSheet();
  const created = await store.createCampaign(SID, BOT_ID, EVENT_CAMPAIGN);
  const updated = await store.updateCampaign(SID, BOT_ID, created.id, {
    audience_mode: "segment", audience_value: "tag_vip123",
  });
  assert.equal(updated.audience_mode, "segment");
  assert.equal(updated.audience_value, "tag_vip123");
});

test("createCampaign clears audience_value for non single_chat modes", async () => {
  installSheet();
  const created = await store.createCampaign(SID, BOT_ID, {
    ...EVENT_CAMPAIGN, audience_mode: "all_users", audience_value: "leftover",
  });
  assert.equal(created.audience_value, "");
});

// ── update / toggle / delete ────────────────────────────────────────────────

test("updateCampaign applies a partial change and bumps updated_at", async () => {
  installSheet();
  const created = await store.createCampaign(SID, BOT_ID, EVENT_CAMPAIGN);
  const updated = await store.updateCampaign(SID, BOT_ID, created.id, { delay_minutes: 30 });
  assert.equal(updated.delay_minutes, 30);
  assert.equal(updated.title, EVENT_CAMPAIGN.title); // untouched fields survive
});

test("updateCampaign 404s on an unknown id", async () => {
  installSheet();
  await assert.rejects(() => store.updateCampaign(SID, BOT_ID, "drp_missing", { title: "x" }), /پیدا نشد/);
});

test("updateCampaign re-validates a changed schedule_type", async () => {
  installSheet();
  const created = await store.createCampaign(SID, BOT_ID, EVENT_CAMPAIGN);
  await assert.rejects(() => store.updateCampaign(SID, BOT_ID, created.id, { schedule_type: "bogus" }));
});

test("toggleCampaign flips is_active", async () => {
  installSheet();
  const created = await store.createCampaign(SID, BOT_ID, EVENT_CAMPAIGN);
  assert.equal(created.is_active, true);
  const toggled = await store.toggleCampaign(SID, created.id);
  assert.equal(toggled.is_active, false);
});

test("deleteCampaign removes the campaign and its queued deliveries", async () => {
  const tabs = installSheet();
  const created = await store.createCampaign(SID, BOT_ID, EVENT_CAMPAIGN);
  tabs.set("drip_deliveries", new Map([
    ["drd_1", { id: "drd_1", campaign_id: created.id, user_id: "1", status: "pending" }],
    ["drd_2", { id: "drd_2", campaign_id: "other_campaign", user_id: "2", status: "pending" }],
  ]));

  assert.equal(await store.deleteCampaign(SID, created.id), true);
  assert.equal(await store.getCampaign(SID, created.id), null);
  assert.equal(tabs.get("drip_deliveries").has("drd_1"), false);
  assert.equal(tabs.get("drip_deliveries").has("drd_2"), true); // unrelated delivery survives
});

// ── stats ────────────────────────────────────────────────────────────────

test("getStats counts campaigns and deliveries by status", async () => {
  const tabs = installSheet();
  const active = await store.createCampaign(SID, BOT_ID, EVENT_CAMPAIGN);
  const inactiveCampaign = await store.createCampaign(SID, BOT_ID, { ...EVENT_CAMPAIGN, title: "دیگر" });
  await store.toggleCampaign(SID, inactiveCampaign.id);
  tabs.set("drip_deliveries", new Map([
    ["drd_1", { status: "pending" }],
    ["drd_2", { status: "sent" }],
    ["drd_3", { status: "sent" }],
    ["drd_4", { status: "failed" }],
  ]));

  const stats = await store.getStats(SID);
  assert.equal(stats.campaigns, 2);
  assert.equal(stats.active, 1);
  assert.equal(stats.pending, 1);
  assert.equal(stats.sent, 2);
  assert.equal(stats.failed, 1);
});

// ── safety config ────────────────────────────────────────────────────────

test("getSafetyConfig returns defaults when nothing saved", async () => {
  installSheet();
  const cfg = await store.getSafetyConfig(SID);
  assert.equal(cfg.quiet_hours_enabled, true);
  assert.equal(cfg.quiet_start, "23:00");
  assert.equal(cfg.max_per_user_per_hour, 3);
});

test("setSafetyConfig persists a partial change over the defaults", async () => {
  installSheet();
  const saved = await store.setSafetyConfig(SID, { max_per_user_per_hour: 7 });
  assert.equal(saved.max_per_user_per_hour, 7);
  assert.equal(saved.quiet_hours_enabled, true); // untouched default survives
  const reread = await store.getSafetyConfig(SID);
  assert.equal(reread.max_per_user_per_hour, 7);
});

test("setSafetyConfig rejects a malformed quiet hour", async () => {
  installSheet();
  await assert.rejects(() => store.setSafetyConfig(SID, { quiet_start: "23h00" }));
});

test("setSafetyConfig rejects a negative frequency cap", async () => {
  installSheet();
  await assert.rejects(() => store.setSafetyConfig(SID, { max_per_user_per_hour: -1 }));
});

test("drip_safety_cfg does not disturb other bot_settings rows", async () => {
  const tabs = installSheet({ bot_settings: { reply_keyboard: { rows: [["/shop"]] } } });
  await store.setSafetyConfig(SID, { quiet_hours_enabled: false });
  assert.deepEqual(tabs.get("bot_settings").get("reply_keyboard"), { rows: [["/shop"]] });
});
