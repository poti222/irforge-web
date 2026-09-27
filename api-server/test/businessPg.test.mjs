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

test("businessPg: isKnownPgEntity is scoped to exactly the registered entities — panels/forms/custom_commands/addresses/catalog_* yes, everything else no (conservative-by-design)", async () => {
  const { isKnownPgEntity } = await import("../src/lib/businessPg.ts");
  assert.equal(isKnownPgEntity("panels"), true);
  assert.equal(isKnownPgEntity("forms"), true);
  assert.equal(isKnownPgEntity("custom_commands"), true);
  assert.equal(isKnownPgEntity("addresses"), true);
  assert.equal(isKnownPgEntity("catalog_categories"), true);
  assert.equal(isKnownPgEntity("catalog_items"), true);
  assert.equal(isKnownPgEntity("catalog_item_options"), true);
  assert.equal(isKnownPgEntity("catalog_fulfillments"), true);
  for (const other of ["users", "bot_settings", "workflows", "events", "payments", "wallet"]) {
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

// ─── custom_commands (PHASE 17.8 — live "can't edit" bug, 2026-09-23) ────────

test("businessPg: custom_commands schema matches bot/migrations/sql/0008_custom_commands.sql + business_repository.py's EntitySchema", async () => {
  const { __testables } = await import("../src/lib/businessPg.ts");
  const s = __testables.ENTITY_SCHEMAS.custom_commands;
  assert.ok(s, "custom_commands must be registered");
  assert.deepEqual(s.columns, ["command", "target", "description", "admin_only", "is_active", "created_at"]);
  assert.deepEqual(s.jsonbColumns, [], "every custom_commands column is a scalar, no JSONB");
  assert.equal(s.kvMode, false);
  assert.equal(s.includeIdInValue, false, "the row key IS the command name — no separate id field on the value, unlike Panel/Form");
  assert.equal(s.rowUpdatedAtCol, "updated_at", "no own updated_at field, so no collision");
});

test("businessPg: rowToValue for custom_commands does NOT echo an id (includeIdInValue is false)", async () => {
  const { __testables } = await import("../src/lib/businessPg.ts");
  const s = __testables.ENTITY_SCHEMAS.custom_commands;
  const row = { id: "wallet", command: "wallet", target: "wallet", description: "", admin_only: false, is_active: true, created_at: "x" };
  const value = __testables.rowToValue(s, row);
  assert.equal(value.command, "wallet");
  assert.equal(value.id, undefined, "custom_commands' CustomCommand type has no id field — echoing one back would be wrong here, unlike Panel/Form");
});

// ─── addresses (live "edit doesn't reach the bot" bug, 2026-09-23) ───────────
// kv_mode — the first kv_mode entry this file has ever needed (panels/forms/
// custom_commands are all typed-columns). No columns/jsonbColumns list to
// check against a migration's column set; the whole value is one generic
// JSONB blob, mirroring bot/utils/business_repository.py's "generic
// key-value mode" (kv_mode=True) and bot/migrations/sql/0030_phase2_remaining_entities.sql's
// `addresses (id, tenant_id, value JSONB, created_at, updated_at)`.

test("businessPg: addresses is registered as kv_mode, matching bot/migrations/sql/0030_phase2_remaining_entities.sql + business_repository.py's EntitySchema", async () => {
  const { __testables } = await import("../src/lib/businessPg.ts");
  const s = __testables.ENTITY_SCHEMAS.addresses;
  assert.ok(s, "addresses must be registered");
  assert.equal(s.table, "addresses");
  assert.deepEqual(s.columns, [], "kv_mode entities have no typed columns — the whole record lives in one JSONB value");
  assert.deepEqual(s.jsonbColumns, []);
  assert.equal(s.kvMode, true);
  assert.equal(s.includeIdInValue, false, "the Address record already carries its own id field (addressStore.ts spreads {...value, id}) — echoing it again here would be redundant, not wrong, but false matches the kv_mode convention used by tickets/bot_settings etc. on the bot side");
  assert.equal(s.rowUpdatedAtCol, "updated_at");
});

test("businessPg: rowToValue for a kv_mode entity (addresses) just returns row.value verbatim, no column reconstruction", async () => {
  const { __testables } = await import("../src/lib/businessPg.ts");
  const s = __testables.ENTITY_SCHEMAS.addresses;
  const value = { title: "شعبه مرکزی", latitude: 35.7, longitude: 51.4, photo_file_ids: ["AAA"] };
  const row = { id: "addr1", value };
  assert.deepEqual(__testables.rowToValue(s, row), value);
});

// ─── catalog_categories/catalog_items/catalog_item_options/catalog_fulfillments
// (live "catalog edits don't reach the bot" bug, 2026-09-27) ──────────────────
// Same class as addresses above — utils/business_repository.py's Phase-2 loop
// registers all 4 as kv_mode (0030_phase2_remaining_entities.sql), but this
// file never learned about any of them, so catalogStore.ts's
// assertSheetsAuthoritative() 409'd every write for a cut-over tenant while
// reads stayed on stale Sheets data regardless. catalog_fulfillments is
// bot-only order-fulfillment history (catalogStore.ts never reads/writes it —
// getFulfillmentConfig/setFulfillmentConfig work through catalog_items'
// metadata.fulfillment instead) — registered anyway for parity with the
// bot's own schema list and cutoverEntities.ts/botHealth.ts, which already
// both listed it as "required".

test("businessPg: all 4 catalog entities are registered as kv_mode, matching bot/migrations/sql/0030_phase2_remaining_entities.sql + business_repository.py's EntitySchema", async () => {
  const { __testables } = await import("../src/lib/businessPg.ts");
  for (const entity of ["catalog_categories", "catalog_items", "catalog_item_options", "catalog_fulfillments"]) {
    const s = __testables.ENTITY_SCHEMAS[entity];
    assert.ok(s, `${entity} must be registered`);
    assert.equal(s.table, entity);
    assert.deepEqual(s.columns, [], `${entity} is kv_mode — no typed columns, the whole record lives in one JSONB value`);
    assert.deepEqual(s.jsonbColumns, []);
    assert.equal(s.kvMode, true);
    assert.equal(s.includeIdInValue, false, `${entity}'s own record already carries its own id field (catalogStore.ts spreads {...value, id}) — echoing it again here would be redundant`);
    assert.equal(s.rowUpdatedAtCol, "updated_at");
  }
});

test("businessPg: rowToValue for the catalog kv_mode entities just returns row.value verbatim, no column reconstruction", async () => {
  const { __testables } = await import("../src/lib/businessPg.ts");
  const s = __testables.ENTITY_SCHEMAS.catalog_items;
  const value = { name: "اشتراک VIP", price: 150000, category_id: "cat1", status: "active" };
  const row = { id: "item1", value };
  assert.deepEqual(__testables.rowToValue(s, row), value);
});

// ─── real-Postgres integration tests ────────────────────────────────────────

test("businessPg: pgSetEntity + pgGetEntity + pgListEntity + pgDeleteEntity round-trip each of the 4 catalog entities exactly (kv_mode) — the live bug this closes (catalog edits from the site never reached a cut-over-for-catalog bot)", { skip }, async () => {
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? pgModule;
  const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });
  const { pgSetEntity, pgGetEntity, pgListEntity, pgDeleteEntity } = await import("../src/lib/businessPg.ts");

  const tenantId = "biz-pg-catalog-test-" + Date.now();
  const entities = ["catalog_categories", "catalog_items", "catalog_item_options", "catalog_fulfillments"];

  try {
    for (const entity of entities) {
      const recordId = "rec-1";
      const value = { name: `تست ${entity}`, sort_order: 1, is_active: true, nested: { a: [1, 2, 3] } };

      await pgSetEntity(tenantId, entity, recordId, value);

      const got = await pgGetEntity(tenantId, entity, recordId);
      assert.equal(got.name, `تست ${entity}`, `${entity}: get after set`);
      assert.deepEqual(got.nested, { a: [1, 2, 3] }, `${entity}: nested JSONB round-trips`);

      const list = await pgListEntity(tenantId, entity);
      assert.equal(list.length, 1, `${entity}: list after set`);
      assert.equal(list[0].key, recordId, `${entity}: list key`);

      const deleted = await pgDeleteEntity(tenantId, entity, recordId);
      assert.equal(deleted, true, `${entity}: delete`);
      assert.equal(await pgGetEntity(tenantId, entity, recordId), null, `${entity}: gone after delete`);
    }
  } finally {
    for (const entity of entities) {
      await rawPool.query(`DELETE FROM ${entity} WHERE tenant_id = $1`, [tenantId]);
    }
    await rawPool.end();
  }
});

test("businessPg: pgSetEntity + pgGetEntity + pgListEntity round-trip a panel exactly, JSONB included", { skip }, async () => {
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

test("businessPg: pgSetEntity + pgGetEntity + pgListEntity round-trip a custom command exactly — the live bug this closes (creating/editing a command could not be edited at all for a cut-over tenant before 'custom_commands' was registered here)", { skip }, async () => {
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? pgModule;
  const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });
  const { pgSetEntity, pgGetEntity, pgListEntity, pgDeleteEntity } = await import("../src/lib/businessPg.ts");

  const tenantId = "biz-pg-cmd-test-" + Date.now();
  const command = {
    command: "wallet", target: "wallet", description: "باز کردن کیف پول",
    admin_only: false, is_active: true, created_at: "2026-01-01T00:00:00",
  };

  try {
    await pgSetEntity(tenantId, "custom_commands", "wallet", command);

    const got = await pgGetEntity(tenantId, "custom_commands", "wallet");
    assert.equal(got.command, "wallet");
    assert.equal(got.target, "wallet");
    assert.equal(got.id, undefined, "no id echoed back — custom_commands has no separate id field on its value");

    const list = await pgListEntity(tenantId, "custom_commands");
    assert.equal(list.length, 1);
    assert.equal(list[0].key, "wallet");

    const deleted = await pgDeleteEntity(tenantId, "custom_commands", "wallet");
    assert.equal(deleted, true);
    assert.equal(await pgGetEntity(tenantId, "custom_commands", "wallet"), null);
  } finally {
    await rawPool.query("DELETE FROM custom_commands WHERE tenant_id = $1", [tenantId]);
    await rawPool.end();
  }
});

test("businessPg: pgSetEntity + pgGetEntity + pgListEntity round-trip an address exactly (kv_mode) — the live bug this closes (address edits from the site never reached a cut-over-for-addresses bot)", { skip }, async () => {
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? pgModule;
  const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });
  const { pgSetEntity, pgGetEntity, pgListEntity, pgDeleteEntity } = await import("../src/lib/businessPg.ts");

  const tenantId = "biz-pg-addr-test-" + Date.now();
  const addressId = "addr-1";
  const address = {
    title: "شعبه مرکزی", text: "خیابان ولیعصر، پلاک ۱", latitude: 35.71954, longitude: 51.40917,
    photo_file_ids: ["AAA111", "AAA222"], phone: "021-12345678", plus_code: "",
    hours_note: "۹ تا ۱۸", is_default: true, is_active: true,
    contact_entries: [{ id: "ce1", kind: "link", label: "واتساپ", value: "https://wa.me/98912" }],
    created_at: "2026-01-01T00:00:00", updated_at: "2026-01-01T00:00:00",
  };

  try {
    await pgSetEntity(tenantId, "addresses", addressId, address);

    const got = await pgGetEntity(tenantId, "addresses", addressId);
    assert.equal(got.title, "شعبه مرکزی");
    assert.equal(got.latitude, 35.71954);
    assert.deepEqual(got.photo_file_ids, ["AAA111", "AAA222"], "the whole value round-trips through JSONB, kv_mode-style — no per-column handling to get wrong");
    assert.deepEqual(got.contact_entries, address.contact_entries);

    const list = await pgListEntity(tenantId, "addresses");
    assert.equal(list.length, 1);
    assert.equal(list[0].key, addressId);

    const deleted = await pgDeleteEntity(tenantId, "addresses", addressId);
    assert.equal(deleted, true);
    assert.equal(await pgGetEntity(tenantId, "addresses", addressId), null);
  } finally {
    await rawPool.query("DELETE FROM addresses WHERE tenant_id = $1", [tenantId]);
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

test("botConfig listEntity leaves a NON-registered entity completely on the old Sheets path even when that tenant is cut over for it (workflows isn't registered in businessPg.ts — only panels/forms/custom_commands are, today)", { skip }, async () => {
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? pgModule;
  const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });
  const botConfig = await import("../src/lib/botConfig.ts");
  const { listEntity, invalidateCutoverCache } = botConfig;

  const tenantId = "biz-dispatch-other-entity-" + Date.now();
  const sheetTabs = new Map([["workflows", new Map([["wf1", { name: "wf1" }]])]]);
  Object.assign(botConfig.sheetLayer, {
    async readTabRows(_sid, tab) {
      const rows = sheetTabs.get(tab);
      return rows ? [...rows.entries()].map(([key, value]) => ({ key, value, raw: false })) : [];
    },
  });

  try {
    await rawPool.query(
      "INSERT INTO entity_cutover_flags (entity_name, tenant_id, use_db) VALUES ('workflows', $1, true)",
      [tenantId]
    );
    invalidateCutoverCache();

    // workflows در businessPg.ts هنوز ثبت نشده — پس حتی با cutover
    // روشن، باید همچنان از همان شیتِ جعلی بخواند (رفتارِ قدیم، دست‌نخورده).
    const rows = await listEntity(tenantId, "workflows");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, "wf1");
  } finally {
    await rawPool.query("DELETE FROM entity_cutover_flags WHERE entity_name = 'workflows' AND tenant_id = $1", [tenantId]);
    invalidateCutoverCache();
    await rawPool.end();
  }
});

// ─── catalog — full dispatch chain, through catalogStore.ts's real exported
// functions (not businessPg.ts directly) — the exact reported symptom this
// closes: "edited a catalog item on the website, restarted the bot, the OLD
// data was still there" for a tenant cut over to Postgres for catalog. ─────

test("catalogStore.createItem/updateItem/deleteItemHard route through botConfig's cutover dispatch to Postgres once cut over for catalog_items, and never touch the fake Sheets layer for that tenant", { skip }, async () => {
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? pgModule;
  const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });
  const botConfig = await import("../src/lib/botConfig.ts");
  const { invalidateCutoverCache } = botConfig;
  const store = await import("../src/lib/catalogStore.ts");

  const cutoverTenant = "biz-catalog-cut-" + Date.now();
  const plainTenant = "biz-catalog-plain-" + Date.now();
  const sheetTabs = new Map([["catalog_items", new Map()]]);
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
      "INSERT INTO entity_cutover_flags (entity_name, tenant_id, use_db) VALUES ('catalog_items', $1, true)",
      [cutoverTenant]
    );
    invalidateCutoverCache();

    // تننتِ کاناری‌شده: create/update/delete واقعیِ catalogStore.ts باید
    // مستقیم روی Postgres برود — دقیقاً همان چیزی که قبلِ این رفع‌باگ با یک
    // 409 (assertSheetsAuthoritative) شکست می‌خورد.
    const created = await store.createItem(cutoverTenant, {
      name: "VIP", name_fa: "وی‌آی‌پی", price: 100000, currency: "IRT",
    }, "u1");
    assert.equal(sheetTabs.get("catalog_items").size, 0, "must NOT have touched the fake Sheets layer at all");

    const updated = await store.updateItem(cutoverTenant, created.id, { price: 250000 });
    assert.equal(updated.price, 250000);

    // خودِ سناریویِ گزارش‌شده: «ادیت کردم، بات را ری‌استارت کردم، هنوز مقدارِ
    // قبلی بود» یعنی یک خوانشِ تازه (شبیه‌سازیِ ری‌استارتِ بات) باید مقدارِ
    // به‌روزشده را ببیند، نه مقدارِ ساخته‌شده‌ی اول.
    const reread = await store.getItem(cutoverTenant, created.id);
    assert.equal(reread.price, 250000);

    // تننتِ دست‌نخورده: باید همچنان دقیقاً همان شیتِ جعلیِ قدیمی را ببیند.
    await store.createItem(plainTenant, {
      name: "Basic", name_fa: "پایه", price: 5000, currency: "IRT",
    }, "u1");
    assert.equal(sheetTabs.get("catalog_items").size, 1, "the untouched tenant's write must land on the fake Sheets layer");

    const deleted = await store.deleteItemHard(cutoverTenant, created.id);
    assert.equal(deleted, true);
    assert.equal(await store.getItem(cutoverTenant, created.id), null);
  } finally {
    await rawPool.query("DELETE FROM entity_cutover_flags WHERE entity_name = 'catalog_items' AND tenant_id = $1", [cutoverTenant]);
    await rawPool.query("DELETE FROM catalog_items WHERE tenant_id = ANY($1)", [[cutoverTenant, plainTenant]]);
    invalidateCutoverCache();
    await rawPool.end();
  }
});
