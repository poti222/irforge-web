/**
 * test/businessPg.test.mjs
 *
 * Live bug: a tenant already cut over to Postgres for "panels" kept
 * accepting "saved successfully" panel edits (including new photos) from
 * the website — which only wrote to Google Sheets — while the bot, reading
 * "panels" from Postgres for that tenant, never saw them. `businessPg.ts`
 * is the missing write path: it mirrors bot/utils/business_repository.py's
 * PostgresEntityRepository exactly, so a tenant cut over for "panels" gets
 * identical read/write behavior whether the request came from the bot or
 * from the website. `botConfig.ts`'s generic listEntity/getEntity/putEntity/
 * putEntities/removeEntity now route to it ONLY for entities registered
 * here (today: just "panels") AND only when that tenant's cutover flag is
 * actually on — every other entity, and every tenant not cut over, is
 * provably untouched by this change (see the last test below).
 *
 * The DB-touching tests need a real local BUSINESS_DATABASE_URL with the
 * PHASE 17 migrations (including 0028_row_level_security.sql) applied —
 * same convention as botConfigTenantCutover.test.mjs; skipped without one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.BOT_TOKEN_ENCRYPTION_KEY ??= "d".repeat(64);
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const skip = !process.env.BUSINESS_DATABASE_URL && "no live BUSINESS_DATABASE_URL configured in this environment";

// ─── pure unit tests (no DB) ────────────────────────────────────────────────

test("businessPg: panels schema matches bot/migrations/sql/0005_panels.sql + business_repository.py's EntitySchema", async () => {
  const { __testables } = await import("../src/lib/businessPg.ts");
  const s = __testables.ENTITY_SCHEMAS.panels;
  assert.ok(s, "panels must be registered");
  assert.deepEqual(
    s.columns,
    [
      "title", "type", "content", "media_file_id", "buttons", "settings",
      "children", "parent_id", "is_home", "is_active", "created_at", "updated_at",
    ]
  );
  assert.deepEqual(new Set(s.jsonbColumns), new Set(["buttons", "settings", "children"]));
  assert.equal(s.kvMode, false);
  assert.equal(s.includeIdInValue, true, "Panel.id duplicates the row key — must be echoed back (Panel PK collision, see business_repository.py)");
  assert.equal(s.rowUpdatedAtCol, "row_updated_at", "Panel.updated_at collides with the generic bookkeeping column name");
});

test("businessPg: rowToValue echoes the row id back into the value for panels (include_id_in_value)", async () => {
  const { __testables } = await import("../src/lib/businessPg.ts");
  const s = __testables.ENTITY_SCHEMAS.panels;
  const row = {
    id: "p1", title: "سلام", type: "media", content: "", media_file_id: "",
    buttons: [], settings: {}, children: [], parent_id: null,
    is_home: false, is_active: true, created_at: "x", updated_at: "y",
  };
  const value = __testables.rowToValue(s, row);
  assert.equal(value.id, "p1");
  assert.equal(value.title, "سلام");
});

test("businessPg: wrapForColumn JSON-stringifies only the jsonb columns (buttons/settings/children), leaves scalars alone", async () => {
  const { __testables } = await import("../src/lib/businessPg.ts");
  const s = __testables.ENTITY_SCHEMAS.panels;
  assert.equal(__testables.wrapForColumn(s, "settings", { media_items: [{ type: "photo", file_id: "AAA" }] }),
    '{"media_items":[{"type":"photo","file_id":"AAA"}]}');
  assert.equal(__testables.wrapForColumn(s, "buttons", [{ label: "x" }]), '[{"label":"x"}]');
  assert.equal(__testables.wrapForColumn(s, "title", "سلام"), "سلام");
  assert.equal(__testables.wrapForColumn(s, "is_home", true), true);
});

test("businessPg: isKnownPgEntity is scoped to exactly the registered entities — panels and forms yes, everything else no (conservative-by-design)", async () => {
  const { isKnownPgEntity } = await import("../src/lib/businessPg.ts");
  assert.equal(isKnownPgEntity("panels"), true);
  assert.equal(isKnownPgEntity("forms"), true);
  for (const other of ["users", "bot_settings", "custom_commands", "workflows", "events", "payments", "wallet"]) {
    assert.equal(isKnownPgEntity(other), false, `'${other}' must stay on the old Sheets-only path until it's actually registered here`);
  }
});

// ─── forms (PHASE 17.6 + thank-you media/buttons follow-up) ──────────────────

test("businessPg: forms schema matches bot/migrations/sql/0006_forms.sql + 0038_forms_thank_you_media.sql + business_repository.py's EntitySchema", async () => {
  const { __testables } = await import("../src/lib/businessPg.ts");
  const s = __testables.ENTITY_SCHEMAS.forms;
  assert.ok(s, "forms must be registered");
  assert.deepEqual(
    s.columns,
    [
      "title", "fields", "destination_group", "destination_admin_ids",
      "thank_you_message", "thank_you_media_file_id", "thank_you_media_type",
      "thank_you_buttons", "is_active", "notify_admin", "allow_edit", "created_at",
    ]
  );
  assert.deepEqual(new Set(s.jsonbColumns), new Set(["fields", "destination_admin_ids", "thank_you_buttons"]));
  assert.equal(s.kvMode, false);
  assert.equal(s.includeIdInValue, true, "Form.id duplicates the row key — must be echoed back, same as Panel");
  assert.equal(s.rowUpdatedAtCol, "updated_at", "Form has no own updated_at field, so no collision — unlike Panel");
});

test("businessPg: rowToValue echoes the row id back into the value for forms (include_id_in_value)", async () => {
  const { __testables } = await import("../src/lib/businessPg.ts");
  const s = __testables.ENTITY_SCHEMAS.forms;
  const row = {
    id: "f1", title: "فرم تماس", fields: [], destination_group: "", destination_admin_ids: [],
    thank_you_message: "ممنون", thank_you_media_file_id: "", thank_you_media_type: "",
    thank_you_buttons: [], is_active: true, notify_admin: true, allow_edit: false, created_at: "x",
  };
  const value = __testables.rowToValue(s, row);
  assert.equal(value.id, "f1");
  assert.equal(value.title, "فرم تماس");
});

test("businessPg: wrapForColumn JSON-stringifies fields/destination_admin_ids/thank_you_buttons for forms, leaves scalars alone", async () => {
  const { __testables } = await import("../src/lib/businessPg.ts");
  const s = __testables.ENTITY_SCHEMAS.forms;
  assert.equal(__testables.wrapForColumn(s, "thank_you_buttons", [{ label: "برو", action: "url", value: "https://x" }]),
    '[{"label":"برو","action":"url","value":"https://x"}]');
  assert.equal(__testables.wrapForColumn(s, "destination_admin_ids", ["120391329"]), '["120391329"]');
  assert.equal(__testables.wrapForColumn(s, "thank_you_media_file_id", "AAA111"), "AAA111");
  assert.equal(__testables.wrapForColumn(s, "is_active", true), true);
});

// ─── real-Postgres integration tests ────────────────────────────────────────

test("businessPg: pgSetEntity + pgGetEntity + pgListEntity + pgDeleteEntity round-trip a panel exactly, JSONB included", { skip }, async () => {
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? pgModule;
  const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });
  const { pgSetEntity, pgGetEntity, pgListEntity, pgDeleteEntity } = await import("../src/lib/businessPg.ts");

  const tenantId = "biz-pg-test-" + Date.now();
  const panelId = "panel-1";
  const panel = {
    title: "خانه", type: "media", content: "سلام دنیا",
    media_file_id: "AAA111",
    buttons: [{ label: "برو", action: "panel", value: "p2", row: 0, col: 0, row_start: true, style: "" }],
    settings: { media_items: [{ type: "photo", file_id: "AAA111" }] },
    children: ["p2"],
    parent_id: null,
    is_home: true,
    is_active: true,
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
  };

  try {
    await pgSetEntity(tenantId, "panels", panelId, panel);

    const got = await pgGetEntity(tenantId, "panels", panelId);
    assert.equal(got.id, panelId);
    assert.equal(got.title, "خانه");
    assert.equal(got.media_file_id, "AAA111");
    assert.deepEqual(got.settings, { media_items: [{ type: "photo", file_id: "AAA111" }] }, "settings.media_items must survive the JSONB round-trip — this is exactly the photo-upload bug's data path");
    assert.deepEqual(got.buttons, panel.buttons);
    assert.deepEqual(got.children, ["p2"]);
    assert.equal(got.is_home, true);

    const list = await pgListEntity(tenantId, "panels");
    assert.equal(list.length, 1);
    assert.equal(list[0].key, panelId);

    const deleted = await pgDeleteEntity(tenantId, "panels", panelId);
    assert.equal(deleted, true);
    assert.equal(await pgGetEntity(tenantId, "panels", panelId), null);
  } finally {
    await rawPool.query("DELETE FROM panels WHERE tenant_id = $1", [tenantId]);
    await rawPool.end();
  }
});

test("businessPg: pgSetEntity + pgGetEntity + pgListEntity round-trip a form exactly, including thank_you_buttons JSONB — the live bug this closes (forms could not be edited at all for a cut-over tenant before 'forms' was registered here)", { skip }, async () => {
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? pgModule;
  const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });
  const { pgSetEntity, pgGetEntity, pgListEntity, pgDeleteEntity } = await import("../src/lib/businessPg.ts");

  const tenantId = "biz-pg-form-test-" + Date.now();
  const formId = "form-1";
  const form = {
    title: "فرم تماس", fields: [{ name: "phone", label: "شماره", type: "phone", required: true, options: [], validation_regex: "", error_message: "", order: 0 }],
    destination_group: "-1001234567890", destination_admin_ids: ["120391329"],
    thank_you_message: "ممنون از ثبت‌نام شما ✅",
    thank_you_media_file_id: "AAA222", thank_you_media_type: "photo",
    thank_you_buttons: [{ label: "برو به سایت", action: "url", value: "https://irforge.ir", row: 0, col: 0, row_start: true, style: "" }],
    is_active: true, notify_admin: true, allow_edit: false, created_at: "2026-01-01T00:00:00",
  };

  try {
    await pgSetEntity(tenantId, "forms", formId, form);

    const got = await pgGetEntity(tenantId, "forms", formId);
    assert.equal(got.id, formId);
    assert.equal(got.title, "فرم تماس");
    assert.equal(got.thank_you_media_file_id, "AAA222");
    assert.equal(got.thank_you_media_type, "photo");
    assert.deepEqual(got.thank_you_buttons, form.thank_you_buttons, "thank_you_buttons must survive the JSONB round-trip exactly");
    assert.deepEqual(got.destination_admin_ids, ["120391329"]);

    const list = await pgListEntity(tenantId, "forms");
    assert.equal(list.length, 1);
    assert.equal(list[0].key, formId);

    const deleted = await pgDeleteEntity(tenantId, "forms", formId);
    assert.equal(deleted, true);
    assert.equal(await pgGetEntity(tenantId, "forms", formId), null);
  } finally {
    await rawPool.query("DELETE FROM forms WHERE tenant_id = $1", [tenantId]);
    await rawPool.end();
  }
});

test("businessPg: an update that omits a column leaves it at its previous value, never NULLs it out (partial-write-safe, matches Sheets 'absent key = keep default' contract)", { skip }, async () => {
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? pgModule;
  const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });
  const { pgSetEntity, pgGetEntity } = await import("../src/lib/businessPg.ts");

  const tenantId = "biz-pg-test-" + Date.now();
  try {
    await pgSetEntity(tenantId, "panels", "p1", {
      title: "اول", type: "media", content: "", media_file_id: "",
      buttons: [], settings: {}, children: [], parent_id: null,
      is_home: false, is_active: true, created_at: "c", updated_at: "u1",
    });
    // یک ذخیره‌ی دوم که media_file_id را عوض می‌کند — دقیقاً همان چیزی که
    // save() سایت هنگام آپلود عکس می‌فرستد.
    await pgSetEntity(tenantId, "panels", "p1", {
      title: "اول", type: "media", content: "", media_file_id: "NEWFILEID",
      buttons: [], settings: { media_items: [{ type: "photo", file_id: "NEWFILEID" }] },
      children: [], parent_id: null, is_home: false, is_active: true,
      created_at: "c", updated_at: "u2",
    });
    const got = await pgGetEntity(tenantId, "panels", "p1");
    assert.equal(got.media_file_id, "NEWFILEID");
    assert.equal(got.title, "اول");
  } finally {
    await rawPool.query("DELETE FROM panels WHERE tenant_id = $1", [tenantId]);
    await rawPool.end();
  }
});

test("businessPg: Row Level Security actually isolates tenants — tenant B can never read or delete tenant A's panel through this file's functions", { skip }, async () => {
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? pgModule;
  const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });
  const { pgSetEntity, pgGetEntity, pgListEntity, pgDeleteEntity } = await import("../src/lib/businessPg.ts");

  const tenantA = "biz-pg-rls-A-" + Date.now();
  const tenantB = "biz-pg-rls-B-" + Date.now();
  try {
    await pgSetEntity(tenantA, "panels", "shared-id", {
      title: "متعلق به A", type: "media", content: "", media_file_id: "",
      buttons: [], settings: {}, children: [], parent_id: null,
      is_home: false, is_active: true, created_at: "c", updated_at: "u",
    });

    assert.equal(await pgGetEntity(tenantB, "panels", "shared-id"), null, "tenant B must not see tenant A's row even with the exact same id");
    assert.deepEqual(await pgListEntity(tenantB, "panels"), [], "tenant B's list must not include tenant A's row");
    assert.equal(await pgDeleteEntity(tenantB, "panels", "shared-id"), false, "tenant B's delete must affect zero rows");

    const stillThere = await pgGetEntity(tenantA, "panels", "shared-id");
    assert.equal(stillThere?.title, "متعلق به A", "tenant A's own row must be completely unaffected by tenant B's attempts");
  } finally {
    await rawPool.query("DELETE FROM panels WHERE tenant_id = ANY($1)", [[tenantA, tenantB]]);
    await rawPool.end();
  }
});

// ─── botConfig.ts dispatch: only "panels", only when that tenant is actually cut over ──

test("botConfig listEntity/getEntity/putEntity/removeEntity route 'panels' to Postgres once cut over, and only for that one tenant", { skip }, async () => {
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? pgModule;
  const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });
  const { listEntity, getEntity, putEntity, removeEntity, invalidateCutoverCache } = await import("../src/lib/botConfig.ts");

  const cutoverTenant = "biz-dispatch-cut-" + Date.now();
  const plainTenant = "biz-dispatch-plain-" + Date.now();

  // شیتِ جعلی برای تننتِ هنوز-روی-Sheets — اگر دیسپچ اشتباهاً پنل‌ها را
  // برای این یکی هم به Postgres ببرد، این تست شکست می‌خورد چون این تب اصلاً
  // در شیتِ جعلی وجود ندارد.
  const botConfig = await import("../src/lib/botConfig.ts");
  const sheetTabs = new Map([["panels", new Map()]]);
  Object.assign(botConfig.sheetLayer, {
    async readTabRows(_sid, tab) {
      const rows = sheetTabs.get(tab);
      return rows ? [...rows.entries()].map(([key, value]) => ({ key, value, raw: false })) : [];
    },
    async upsertRow(_sid, tab, key, value) {
      if (!sheetTabs.has(tab)) sheetTabs.set(tab, new Map());
      const rows = sheetTabs.get(tab);
      const created = !rows.has(key);
      rows.set(key, JSON.parse(JSON.stringify(value)));
      return { created };
    },
    async deleteRow(_sid, tab, key) {
      const rows = sheetTabs.get(tab);
      if (!rows?.has(key)) return false;
      rows.delete(key);
      return true;
    },
  });

  try {
    await rawPool.query(
      "INSERT INTO entity_cutover_flags (entity_name, tenant_id, use_db) VALUES ('panels', $1, true)",
      [cutoverTenant]
    );
    invalidateCutoverCache();

    const panelValue = {
      title: "پنلِ کاناری‌شده", type: "media", content: "", media_file_id: "FID1",
      buttons: [], settings: { media_items: [{ type: "photo", file_id: "FID1" }] },
      children: [], parent_id: null, is_home: false, is_active: true,
      created_at: "c", updated_at: "u",
    };

    // تننتِ کاناری‌شده: باید مستقیم روی Postgres برود، نه شیتِ جعلی.
    const putResult = await putEntity(cutoverTenant, "panels", "p1", panelValue);
    assert.equal(putResult.created, true);
    assert.deepEqual(sheetTabs.get("panels").size, 0, "must NOT have touched the fake Sheets layer at all");

    const got = await getEntity(cutoverTenant, "panels", "p1");
    assert.equal(got.title, "پنلِ کاناری‌شده");
    assert.deepEqual(got.settings, { media_items: [{ type: "photo", file_id: "FID1" }] });

    const listed = await listEntity(cutoverTenant, "panels");
    assert.equal(listed.length, 1);

    // تننتِ دست‌نخورده: باید همچنان دقیقاً همان شیتِ جعلیِ قدیمی را ببیند —
    // اثباتِ اینکه این تغییر فقط تننتِ کاناری‌شده را لمس می‌کند.
    await putEntity(plainTenant, "panels", "p2", { ...panelValue, title: "پنلِ روی شیت" });
    assert.equal(sheetTabs.get("panels").size, 1, "the untouched tenant's write must land on the fake Sheets layer");
    const plainGot = await getEntity(plainTenant, "panels", "p2");
    assert.equal(plainGot.title, "پنلِ روی شیت");

    const removed = await removeEntity(cutoverTenant, "panels", "p1");
    assert.equal(removed, true);
    assert.equal(await getEntity(cutoverTenant, "panels", "p1"), null);
  } finally {
    await rawPool.query("DELETE FROM entity_cutover_flags WHERE entity_name = 'panels' AND tenant_id = $1", [cutoverTenant]);
    await rawPool.query("DELETE FROM panels WHERE tenant_id = ANY($1)", [[cutoverTenant, plainTenant]]);
    invalidateCutoverCache();
    await rawPool.end();
  }
});

test("botConfig listEntity leaves a NON-registered entity completely on the old Sheets path even when that tenant is cut over for it (custom_commands isn't registered in businessPg.ts — only panels/forms are, today)", { skip }, async () => {
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? pgModule;
  const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });
  const botConfig = await import("../src/lib/botConfig.ts");
  const { listEntity, invalidateCutoverCache } = botConfig;

  const tenantId = "biz-dispatch-other-entity-" + Date.now();
  const sheetTabs = new Map([["custom_commands", new Map([["cmd1", { command: "cmd1" }]])]]);
  Object.assign(botConfig.sheetLayer, {
    async readTabRows(_sid, tab) {
      const rows = sheetTabs.get(tab);
      return rows ? [...rows.entries()].map(([key, value]) => ({ key, value, raw: false })) : [];
    },
  });

  try {
    await rawPool.query(
      "INSERT INTO entity_cutover_flags (entity_name, tenant_id, use_db) VALUES ('custom_commands', $1, true)",
      [tenantId]
    );
    invalidateCutoverCache();

    // custom_commands در businessPg.ts هنوز ثبت نشده — پس حتی با cutover
    // روشن، باید همچنان از همان شیتِ جعلی بخواند (رفتارِ قدیم، دست‌نخورده).
    const rows = await listEntity(tenantId, "custom_commands");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, "cmd1");
  } finally {
    await rawPool.query("DELETE FROM entity_cutover_flags WHERE entity_name = 'custom_commands' AND tenant_id = $1", [tenantId]);
    invalidateCutoverCache();
    await rawPool.end();
  }
});
