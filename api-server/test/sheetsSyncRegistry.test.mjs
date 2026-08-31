/**
 * test/sheetsSyncRegistry.test.mjs — IRFORGE_BOTS_REGISTRY_POSTGRES_MIGRATION.
 *
 * `sheetsSync.ts`'s registry sync (`syncTenantUpsert`/`syncSheetPoolUpsert`)
 * is a fire-and-forget dual write: Sheets (as always) plus, when mainbot's
 * `tenant_registry` cutover flag is on, the same `BUSINESS_DATABASE_URL`
 * Postgres tables mainbot's own `business_repository.py` reads. This
 * sandbox has no live BUSINESS_DATABASE_URL (same limitation
 * mainbot/migrations/data/migrate_registry.py's own docstring notes), so:
 *
 *   - the pure value-building logic (is bot_token really encrypted, is the
 *     rest of the shape exactly what registry.py expects) is tested
 *     directly, with no I/O at all — `buildTenantRegistryValue`/
 *     `buildSheetPoolValue` were extracted from the sync functions
 *     specifically so this doesn't need mocking Sheets or Postgres;
 *   - the Postgres write path is tested for its documented fail-open
 *     contract (no BUSINESS_DATABASE_URL configured -> resolves without
 *     throwing, exactly today's production reality pre-cutover).
 */
process.env.BOT_TOKEN_ENCRYPTION_KEY ??= "c".repeat(64);
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";
delete process.env.BUSINESS_DATABASE_URL;

import { test } from "node:test";
import assert from "node:assert/strict";

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

test("registryPgUpsert resolves without throwing when BUSINESS_DATABASE_URL is unset", async () => {
  await registryPgUpsert("registry_tenants", "t1", { bot_token: "x" });
});

test("registryPgDelete resolves without throwing when BUSINESS_DATABASE_URL is unset", async () => {
  await registryPgDelete("registry_tenants", "t1");
});
