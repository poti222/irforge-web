/**
 * test/cutoverFlags.test.mjs — IRFORGE_POSTGRES_PRIMARY_SHEETS_BACKUP_PROMPT فاز ۱.
 *
 * سه ادعا:
 *   ۱. هر دو روت (GET فهرست، PATCH سوییچ) واقعاً پشتِ `requireSuperAdmin` هستند
 *      — همان سبکِ source-check که `internalTicketNotify.test.mjs` برای گیت‌ها
 *      استفاده می‌کند؛ رفتارِ خودِ `requireSuperAdmin` (نقشِ admin کافی نیست)
 *      از قبل در auth-guards.test.mjs ثابت شده، اینجا فقط اثباتِ *استفاده* از
 *      همان گیت لازم است.
 *   ۲. `isKnownCutoverEntity` جلویِ اسمِ اختراعی را می‌گیرد (روتِ PATCH را از
 *      نوشتنِ یک entity_name دلخواه توسطِ کاربر امن می‌کند).
 *   ۳. `setEntityUseDb` واقعاً ردیفِ `entity_cutover_flags` را در Postgres
 *      عوض می‌کند — نه فقط کشِ حافظه را — با یک خواندنِ مستقلِ raw SQL که به
 *      خودِ `setEntityUseDb`/`cutoverAdminSummary` هیچ اعتمادی نمی‌کند.
 *      این بخش فقط وقتی اجرا می‌شود که یک BUSINESS_DATABASE_URL واقعی روی
 *      محیط تنظیم شده باشد (همان قراردادِ test_phaseB_cutover_entities_contract.py
 *      سمتِ بات) — این sandbox با یک Postgres محلیِ throwaway اجرا شد.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.BOT_TOKEN_ENCRYPTION_KEY ??= "d".repeat(64);
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const __dirname = dirname(fileURLToPath(import.meta.url));
const routeSource = readFileSync(join(__dirname, "../src/routes/cutoverFlags.ts"), "utf-8");

test("GET /superadmin/cutover-flags is gated by requireSuperAdmin", () => {
  const guard = routeSource.match(/router\.get\(\s*"\/superadmin\/cutover-flags"\s*,\s*requireSuperAdmin/);
  assert.ok(guard, "the GET route must list requireSuperAdmin as middleware");
});

test("PATCH /superadmin/cutover-flags/:entity is gated by requireSuperAdmin", () => {
  const guard = routeSource.match(/router\.patch\(\s*"\/superadmin\/cutover-flags\/:entity"\s*,\s*requireSuperAdmin/);
  assert.ok(guard, "the PATCH route must list requireSuperAdmin as middleware");
});

test("PATCH validates enabled is a boolean before writing anything", () => {
  const guard = routeSource.match(/typeof enabled !== "boolean"/);
  assert.ok(guard, "a non-boolean enabled must be rejected before setEntityUseDb is called");
});

test("PATCH rejects an unknown entity before writing anything", () => {
  const guard = routeSource.match(/isKnownCutoverEntity\(entity\)/);
  assert.ok(guard, "an entity outside the canonical list must be rejected (404) before any write");
});

// ─── isKnownCutoverEntity ────────────────────────────────────────────────────

const { isKnownCutoverEntity, CUTOVER_ENTITIES } = await import("../src/lib/cutoverEntities.ts");

test("isKnownCutoverEntity accepts every entity in the canonical list", () => {
  for (const entity of CUTOVER_ENTITIES) {
    assert.equal(isKnownCutoverEntity(entity), true, entity);
  }
});

test("isKnownCutoverEntity rejects a made-up entity name", () => {
  assert.equal(isKnownCutoverEntity("__drop_table_users__"), false);
  assert.equal(isKnownCutoverEntity("bot_settings; DROP TABLE users"), false);
});

test("the three Phase 1 target entities (bot_settings/custom_commands/events) are in the canonical list", () => {
  for (const e of ["bot_settings", "custom_commands", "events"]) {
    assert.ok(CUTOVER_ENTITIES.includes(e), e);
  }
});

// ─── real Postgres write-through ────────────────────────────────────────────

test("setEntityUseDb actually flips entity_cutover_flags in Postgres (not just an in-memory mock)", { skip: !process.env.BUSINESS_DATABASE_URL && "no live BUSINESS_DATABASE_URL configured in this environment" }, async () => {
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? pgModule;
  const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });

  const { setEntityUseDb, cutoverAdminSummary, invalidateCutoverCache } = await import("../src/lib/botConfig.ts");

  try {
    // شروع تمیز — این تست باید بی‌اثر از تست‌های قبلی روی همین ردیف باشد.
    await rawPool.query("DELETE FROM entity_cutover_flags WHERE entity_name = 'bot_settings' AND tenant_id IS NULL");
    invalidateCutoverCache();

    let { rows } = await rawPool.query(
      "SELECT use_db FROM entity_cutover_flags WHERE entity_name = 'bot_settings' AND tenant_id IS NULL"
    );
    assert.equal(rows.length, 0, "no row should exist yet");

    await setEntityUseDb("bot_settings", true);

    ({ rows } = await rawPool.query(
      "SELECT use_db FROM entity_cutover_flags WHERE entity_name = 'bot_settings' AND tenant_id IS NULL"
    ));
    assert.equal(rows.length, 1, "setEntityUseDb must actually insert/update the row in Postgres");
    assert.equal(rows[0].use_db, true);

    const summary = await cutoverAdminSummary();
    const row = summary.find((r) => r.entity === "bot_settings");
    assert.ok(row, "bot_settings must appear in cutoverAdminSummary()");
    assert.equal(row.useDb, true, "cutoverAdminSummary must reflect the just-written value, not a stale cache");

    await setEntityUseDb("bot_settings", false);
    ({ rows } = await rawPool.query(
      "SELECT use_db FROM entity_cutover_flags WHERE entity_name = 'bot_settings' AND tenant_id IS NULL"
    ));
    assert.equal(rows[0].use_db, false, "flipping back to false must also actually write through");
  } finally {
    await rawPool.query("DELETE FROM entity_cutover_flags WHERE entity_name = 'bot_settings' AND tenant_id IS NULL");
    await rawPool.end();
  }
});

test("cutoverAdminSummary counts per-tenant overrides separately from the global flag", { skip: !process.env.BUSINESS_DATABASE_URL && "no live BUSINESS_DATABASE_URL configured in this environment" }, async () => {
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? pgModule;
  const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });
  const { cutoverAdminSummary, invalidateCutoverCache } = await import("../src/lib/botConfig.ts");

  try {
    await rawPool.query("DELETE FROM entity_cutover_flags WHERE entity_name = 'events'");
    await rawPool.query(
      "INSERT INTO entity_cutover_flags (entity_name, tenant_id, use_db) VALUES ('events', NULL, false), ('events', 'tenantA', true), ('events', 'tenantB', true)"
    );
    invalidateCutoverCache();

    const summary = await cutoverAdminSummary();
    const row = summary.find((r) => r.entity === "events");
    assert.ok(row);
    assert.equal(row.useDb, false, "the global row's value, not an override's");
    assert.equal(row.tenantOverrideCount, 2);
  } finally {
    await rawPool.query("DELETE FROM entity_cutover_flags WHERE entity_name = 'events'");
    await rawPool.end();
  }
});
