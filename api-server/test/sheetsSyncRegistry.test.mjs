/**
 * test/sheetsSyncRegistry.test.mjs — IRFORGE_BOTS_REGISTRY_POSTGRES_MIGRATION,
 * extended by IRFORGE_POSTGRES_PRIMARY_SHEETS_BACKUP_PROMPT فازِ ۳.
 *
 * `sheetsSync.ts`'s registry sync (`syncTenantUpsert`/`syncSheetPoolUpsert`)
 * used to be an unconditional fire-and-forget dual write: Sheets always,
 * plus, when mainbot's `tenant_registry` cutover flag is on, the same
 * `BUSINESS_DATABASE_URL` Postgres tables mainbot's own
 * `business_repository.py` reads. Phase 3 changed that: once
 * `tenant_registry` is Postgres-authoritative, the Sheets write is now
 * SKIPPED entirely (Postgres becomes the sole live write target — see the
 * "Sheets skip" tests below). This sandbox has no live Google Sheets
 * credentials (same limitation mainbot/migrations/data/migrate_registry.py's
 * own docstring notes for its side), so:
 *
 *   - the pure value-building logic (is bot_token really encrypted, is the
 *     rest of the shape exactly what registry.py expects) is tested
 *     directly, with no I/O at all — `buildTenantRegistryValue`/
 *     `buildSheetPoolValue` were extracted from the sync functions
 *     specifically so this doesn't need mocking Sheets or Postgres;
 *   - the Postgres write path is tested for its documented fail-open
 *     contract (no BUSINESS_DATABASE_URL configured -> resolves without
 *     throwing) AND, where a live BUSINESS_DATABASE_URL is configured
 *     (this sandbox has a local Postgres 16 for exactly this), for a real
 *     write-through — same convention cutoverFlags.test.mjs already uses;
 *   - the "stop writing Sheets once cut over" behavior is a source-scan
 *     assertion (this file has no live Sheets connection to observe an
 *     actually-skipped network call against), matching the same
 *     established pattern cutoverFlags.test.mjs uses for route gating.
 */
process.env.BOT_TOKEN_ENCRYPTION_KEY ??= "c".repeat(64);
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { test } from "node:test";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sheetsSyncSource = readFileSync(join(__dirname, "../src/lib/sheetsSync.ts"), "utf-8");

const { __testables } = await import("../src/lib/sheetsSync.ts");
const { decryptToken } = await import("../src/lib/tokenCrypto.ts");
const { buildTenantRegistryValue, buildSheetPoolValue, registryPgUpsert, registryPgDelete } = __testables;

// ─── buildTenantRegistryValue ───────────────────────────────────────────────

test("bot_token is encrypted, not plaintext, in the stored value", () => {
  const value = buildTenantRegistryValue({
    bot_token: "123:LIVE-TOKEN",
    bot_name: "MyBot",
    owner_user_id: "user-1",
  });
  assert.notEqual(value.bot_token, "123:LIVE-TOKEN");
  assert.equal(value.bot_token.split(":").length, 3); // iv:tag:ciphertext
  assert.equal(decryptToken(value.bot_token), "123:LIVE-TOKEN");
});

test("field names exactly match what mainbot's registry.py reads", () => {
  const value = buildTenantRegistryValue({
    bot_token: "t1",
    bot_name: "MyBot",
    bot_username: "my_bot",
    owner_user_id: "user-1",
    owner_telegram_id: "999",
    sheet_id: "sheet-abc",
    admin_password: "secret",
    status: "active",
    bot_purpose: "shop",
    created_at: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(value.bot_name, "MyBot");
  assert.equal(value.bot_username, "my_bot");
  assert.equal(value.spreadsheet_id, "sheet-abc");
  assert.equal(value.owner_id, "999"); // telegram id preferred over site user id
  assert.equal(value.admin_password, "secret");
  assert.equal(value.status, "active");
  assert.equal(value.bot_purpose, "shop");
  // legacy aliases
  assert.equal(value.sheet_id, "sheet-abc");
  assert.equal(value.owner_user_id, "user-1");
  assert.equal(value.created_at, "2026-01-01T00:00:00.000Z");
});

test("owner_id falls back to the site user id when no telegram id is known", () => {
  const value = buildTenantRegistryValue({ bot_token: "t1", bot_name: "B", owner_user_id: "user-1" });
  assert.equal(value.owner_id, "user-1");
});

test("defaults: status active, bot_purpose/admin_password empty string, sheet_id empty string", () => {
  const value = buildTenantRegistryValue({ bot_token: "t1", bot_name: "B", owner_user_id: "user-1" });
  assert.equal(value.status, "active");
  assert.equal(value.bot_purpose, "");
  assert.equal(value.admin_password, "");
  assert.equal(value.spreadsheet_id, "");
});

test("repeated calls for the same token produce different ciphertexts (random IV)", () => {
  const a = buildTenantRegistryValue({ bot_token: "t1", bot_name: "B", owner_user_id: "u" });
  const b = buildTenantRegistryValue({ bot_token: "t1", bot_name: "B", owner_user_id: "u" });
  assert.notEqual(a.bot_token, b.bot_token);
});

// ─── buildSheetPoolValue ─────────────────────────────────────────────────────

test("sheet pool used_by is left as plain text (not encrypted) by design", () => {
  const value = buildSheetPoolValue({ sheet_id: "sheet-a", used_by: "123:LIVE-TOKEN", status: "assigned" });
  assert.deepEqual(value, { spreadsheet_id: "sheet-a", used_by: "123:LIVE-TOKEN" });
});

test("used_by is null unless status is exactly 'assigned'", () => {
  assert.equal(buildSheetPoolValue({ sheet_id: "s", used_by: "t1", status: "free" }).used_by, null);
  assert.equal(buildSheetPoolValue({ sheet_id: "s", used_by: "t1", status: "available" }).used_by, null);
  assert.equal(buildSheetPoolValue({ sheet_id: "s", used_by: "t1", status: "assigned" }).used_by, "t1");
});

// ─── registry Postgres write path — fail-open without BUSINESS_DATABASE_URL ─
//
// Each test here saves/restores process.env.BUSINESS_DATABASE_URL itself
// (rather than the whole file deleting it once at import time) so these
// can coexist with the live-Postgres tests further down in the same file.

test("registryPgUpsert resolves without throwing when BUSINESS_DATABASE_URL is unset", async () => {
  const saved = process.env.BUSINESS_DATABASE_URL;
  delete process.env.BUSINESS_DATABASE_URL;
  try {
    await registryPgUpsert("registry_tenants", "t1", { bot_token: "x" });
  } finally {
    if (saved !== undefined) process.env.BUSINESS_DATABASE_URL = saved;
  }
});

test("registryPgDelete resolves without throwing when BUSINESS_DATABASE_URL is unset", async () => {
  const saved = process.env.BUSINESS_DATABASE_URL;
  delete process.env.BUSINESS_DATABASE_URL;
  try {
    await registryPgDelete("registry_tenants", "t1");
  } finally {
    if (saved !== undefined) process.env.BUSINESS_DATABASE_URL = saved;
  }
});

// ─── Phase 3: stop the Sheets write once tenant_registry is cut over ───────
//
// No live Sheets credentials in this sandbox to observe an actually-skipped
// network call against, so this is a source-scan proof (same established
// pattern api-server/test/cutoverFlags.test.mjs uses for route gating):
// each registry sync function must check isEntityOnPostgres("tenant_registry")
// and return BEFORE reaching its Sheets write, positioned after (not
// instead of) the unconditional Postgres write above it.

function functionBody(name) {
  const start = sheetsSyncSource.indexOf(`export function ${name}(`);
  assert.ok(start >= 0, `${name} not found in sheetsSync.ts`);
  const nextExport = sheetsSyncSource.indexOf("\nexport function ", start + 1);
  return sheetsSyncSource.slice(start, nextExport >= 0 ? nextExport : undefined);
}

for (const name of ["syncTenantUpsert", "syncTenantDelete", "syncSheetPoolUpsert", "syncSheetPoolDelete"]) {
  test(`${name} checks isEntityOnPostgres("tenant_registry") after the Postgres write, before the Sheets write`, () => {
    const body = functionBody(name);
    const pgCallIdx = body.search(/await registryPg(Upsert|Delete)\(/);
    const guardIdx = body.indexOf('isEntityOnPostgres("tenant_registry")');
    const sheetsWriteIdx = body.search(/await (upsertKV|deleteKVByKey)\(/);

    assert.ok(pgCallIdx >= 0, `${name} must still call registryPgUpsert/Delete`);
    assert.ok(guardIdx >= 0, `${name} must check isEntityOnPostgres("tenant_registry")`);
    assert.ok(sheetsWriteIdx >= 0, `${name} must still have a Sheets write for the not-cut-over case`);
    assert.ok(pgCallIdx < guardIdx, "the Postgres write must happen before the cutover check");
    assert.ok(guardIdx < sheetsWriteIdx, "the cutover check must gate the Sheets write");
  });
}

// ─── live Postgres — tenant_registry specifically drives the guard ────────

test(
  "isEntityOnPostgres('tenant_registry') reflects a real flip, and registryPgUpsert writes through when it's on",
  { skip: !process.env.BUSINESS_DATABASE_URL && "no live BUSINESS_DATABASE_URL configured in this environment" },
  async () => {
    const pgModule = await import("pg");
    const { Pool } = pgModule.default ?? pgModule;
    const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });
    const { isEntityOnPostgres, invalidateCutoverCache } = await import("../src/lib/botConfig.ts");

    // registry_tenants has Row-Level Security (see sheetsSync.ts's own
    // withRegistryTenantContext comment) -- this test runs against the
    // real non-superuser irforge_app_runtime role (same as mainbot's own
    // RLS test suite), so every statement touching that table, including
    // this test's own verification SELECT and cleanup DELETE, must set
    // app.tenant_id in the same transaction or RLS silently hides the row.
    async function asRegistryTenant(sql, params = []) {
      const client = await rawPool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL app.tenant_id = '__registry__'");
        const result = await client.query(sql, params);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }

    try {
      await rawPool.query("DELETE FROM entity_cutover_flags WHERE entity_name = 'tenant_registry' AND tenant_id IS NULL");
      await asRegistryTenant("DELETE FROM registry_tenants WHERE tenant_id = '__registry__' AND id = 'phase3-test-token'");
      invalidateCutoverCache();

      assert.equal(await isEntityOnPostgres("tenant_registry"), false, "defaults to Sheets-authoritative");

      await rawPool.query(
        "INSERT INTO entity_cutover_flags (entity_name, tenant_id, use_db) VALUES ('tenant_registry', NULL, true)"
      );
      invalidateCutoverCache();
      assert.equal(await isEntityOnPostgres("tenant_registry"), true);

      await registryPgUpsert("registry_tenants", "phase3-test-token", { bot_token: "encrypted-value" });
      const { rows } = await asRegistryTenant(
        "SELECT value FROM registry_tenants WHERE tenant_id = '__registry__' AND id = 'phase3-test-token'"
      );
      assert.equal(rows.length, 1, "registryPgUpsert must actually write the row when tenant_registry is on");
      assert.equal(rows[0].value.bot_token, "encrypted-value");

      await registryPgDelete("registry_tenants", "phase3-test-token");
      const after = await asRegistryTenant(
        "SELECT value FROM registry_tenants WHERE tenant_id = '__registry__' AND id = 'phase3-test-token'"
      );
      assert.equal(after.rows.length, 0, "registryPgDelete must actually remove the row when tenant_registry is on");
    } finally {
      await rawPool.query("DELETE FROM entity_cutover_flags WHERE entity_name = 'tenant_registry' AND tenant_id IS NULL");
      await asRegistryTenant("DELETE FROM registry_tenants WHERE tenant_id = '__registry__' AND id = 'phase3-test-token'");
      invalidateCutoverCache();
      await rawPool.end();
    }
  }
);
