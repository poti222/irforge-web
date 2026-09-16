/**
 * test/botConfigTenantCutover.test.mjs
 *
 * IRFORGE_POSTGRES_PRIMARY_SHEETS_BACKUP_PROMPT — per-tenant cutover fix.
 *
 * Before this fix, `isEntityOnPostgres`/`assertSheetsAuthoritative` flattened
 * every `entity_cutover_flags` row (global AND every per-tenant override)
 * into one map keyed only by entity_name — a per-tenant override for tenant
 * A would silently change (or be silently overridden by) the read for every
 * OTHER tenant of that same entity. That was harmless only because no
 * per-tenant override had ever been used in production; the new Sheets
 * Import superadmin feature makes per-tenant overrides routine, so this had
 * to become tenant-aware before that feature could ship safely — a tenant
 * migrated to Postgres must not have the website keep silently writing its
 * edits to that tenant's now-stale Sheets tab (which the bot no longer
 * reads for that entity), while every OTHER tenant must be completely
 * unaffected by that one tenant's migration.
 *
 * These tests prove the exact isolation property, against a real local
 * Postgres — only skipped without one configured.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.BOT_TOKEN_ENCRYPTION_KEY ??= "d".repeat(64);
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const skip = !process.env.BUSINESS_DATABASE_URL && "no live BUSINESS_DATABASE_URL configured in this environment";

test("isEntityOnPostgres resolves per-tenant overrides in isolation, explicit tenantId", { skip }, async () => {
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? pgModule;
  const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });
  const { isEntityOnPostgres, invalidateCutoverCache } = await import("../src/lib/botConfig.ts");

  const tenantA = "tenantA-" + Date.now();
  const tenantB = "tenantB-" + Date.now();

  // A dedicated, otherwise-unused entity name for this test's GLOBAL
  // (tenant_id IS NULL) row -- unlike a tenant-scoped row, a global row
  // isn't distinguishable by a unique per-test tenant id, so it can only
  // be made safe against other concurrently-running test files (node:test
  // runs files in parallel) by not sharing the entity name at all.
  // cutoverFlags.test.mjs owns 'bot_settings'/'events' for this exact
  // purpose; sheetsImport.test.mjs owns 'bot_settings'/'custom_commands'
  // scoped by tenant_id.
  const globalTestEntity = "wallets";

  try {
    await rawPool.query("DELETE FROM entity_cutover_flags WHERE entity_name = $1", [globalTestEntity]);
    await rawPool.query(
      "INSERT INTO entity_cutover_flags (entity_name, tenant_id, use_db) VALUES ($1, NULL, false), ($1, $2, true)",
      [globalTestEntity, tenantA]
    );
    invalidateCutoverCache();

    assert.equal(await isEntityOnPostgres(globalTestEntity, tenantA), true, "tenant A's own override must apply");
    assert.equal(
      await isEntityOnPostgres(globalTestEntity, tenantB),
      false,
      "tenant B must fall back to the global default, unaffected by tenant A's override"
    );
    assert.equal(
      await isEntityOnPostgres(globalTestEntity),
      false,
      "no tenant context at all must also fall back to the global default"
    );
  } finally {
    await rawPool.query("DELETE FROM entity_cutover_flags WHERE entity_name = $1", [globalTestEntity]);
    await rawPool.end();
  }
});

test("resolveBotSheet seeds the request's tenant context so assertSheetsAuthoritative picks up that bot's override automatically", { skip }, async () => {
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? pgModule;
  const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });
  const {
    isEntityOnPostgres,
    assertSheetsAuthoritative,
    invalidateCutoverCache,
    __setTenantCutoverContextForTests,
  } = await import("../src/lib/botConfig.ts");

  const migratedTenant = "migrated-" + Date.now();
  const untouchedTenant = "untouched-" + Date.now();

  try {
    // Scoped to this test's own dynamic tenant ids, not a blanket delete by
    // entity_name -- sheetsImport.test.mjs's tests use the same
    // 'custom_commands' entity concurrently, for their own tenants.
    await rawPool.query("DELETE FROM entity_cutover_flags WHERE entity_name = 'custom_commands' AND tenant_id = ANY($1)", [
      [migratedTenant, untouchedTenant],
    ]);
    await rawPool.query(
      "INSERT INTO entity_cutover_flags (entity_name, tenant_id, use_db) VALUES ('custom_commands', $1, true)",
      [migratedTenant]
    );
    invalidateCutoverCache();

    // Simulates what resolveBotSheet's enterWith() does for the rest of a
    // request, without needing a real HTTP request + DB-backed bot row.
    await __setTenantCutoverContextForTests(migratedTenant, async () => {
      assert.equal(await isEntityOnPostgres("custom_commands"), true);
      await assert.rejects(
        () => assertSheetsAuthoritative("custom_commands"),
        (err) => err.status === 409 && err.code === "entity_on_postgres"
      );
    });

    await __setTenantCutoverContextForTests(untouchedTenant, async () => {
      assert.equal(await isEntityOnPostgres("custom_commands"), false);
      await assert.doesNotReject(() => assertSheetsAuthoritative("custom_commands"));
    });
  } finally {
    await rawPool.query("DELETE FROM entity_cutover_flags WHERE entity_name = 'custom_commands' AND tenant_id = ANY($1)", [
      [migratedTenant, untouchedTenant],
    ]);
    await rawPool.end();
  }
});
