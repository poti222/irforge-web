/**
 * test/sheetsImport.test.mjs — IRFORGE_POSTGRES_PRIMARY_SHEETS_BACKUP_PROMPT فاز ۲.
 *
 * ادعاها:
 *   ۱. هر سه روت (GET bots, GET requests, POST :botId, POST bulk) واقعاً
 *      پشتِ `requireSuperAdmin` هستند — همان سبکِ source-check که
 *      cutoverFlags.test.mjs استفاده می‌کند.
 *   ۲. `enqueueSheetsImport` واقعاً یک ردیفِ `pending` در
 *      `sheets_import_requests` می‌سازد — با یک خواندنِ مستقلِ raw SQL.
 *   ۳. `listTenantImportStatuses` تعدادِ درستِ entityهای Postgres-authoritative
 *      هر تننت را برمی‌گرداند و آخرین درخواستش را پیدا می‌کند، بدونِ قاطی‌کردنِ
 *      تننت‌های دیگر.
 *   ۴. `listRecentSheetsImportRequests` جدید-به-قدیم مرتب می‌کند.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.BOT_TOKEN_ENCRYPTION_KEY ??= "d".repeat(64);
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const __dirname = dirname(fileURLToPath(import.meta.url));
const routeSource = readFileSync(join(__dirname, "../src/routes/sheetsImport.ts"), "utf-8");

test("GET /superadmin/sheets-import/bots is gated by requireSuperAdmin", () => {
  const guard = routeSource.match(/router\.get\(\s*"\/superadmin\/sheets-import\/bots"\s*,\s*requireSuperAdmin/);
  assert.ok(guard, "the GET bots route must list requireSuperAdmin as middleware");
});

test("GET /superadmin/sheets-import/requests is gated by requireSuperAdmin", () => {
  const guard = routeSource.match(/router\.get\(\s*"\/superadmin\/sheets-import\/requests"\s*,\s*requireSuperAdmin/);
  assert.ok(guard, "the GET requests route must list requireSuperAdmin as middleware");
});

test("POST /superadmin/sheets-import/:botId is gated by requireSuperAdmin", () => {
  const guard = routeSource.match(/router\.post\(\s*"\/superadmin\/sheets-import\/:botId"\s*,\s*requireSuperAdmin/);
  assert.ok(guard, "the POST :botId route must list requireSuperAdmin as middleware");
});

test("POST /superadmin/sheets-import/bulk is gated by requireSuperAdmin", () => {
  const guard = routeSource.match(/router\.post\(\s*"\/superadmin\/sheets-import\/bulk"\s*,\s*requireSuperAdmin/);
  assert.ok(guard, "the POST bulk route must list requireSuperAdmin as middleware");
});

test("POST /superadmin/sheets-import/:botId rejects a bot with no sheet before enqueueing anything", () => {
  const guard = routeSource.match(/if \(!bot\.sheetId\)/);
  assert.ok(guard, "a bot without sheetId must be rejected before enqueueSheetsImport is called");
});

// ─── real Postgres write-through ────────────────────────────────────────────

const skip = !process.env.BUSINESS_DATABASE_URL && "no live BUSINESS_DATABASE_URL configured in this environment";

test("enqueueSheetsImport actually inserts a pending row in Postgres", { skip }, async () => {
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? pgModule;
  const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });
  const { enqueueSheetsImport } = await import("../src/lib/sheetsImport.ts");

  const tenantId = "sheets-import-web-test-" + Date.now();
  try {
    const request = await enqueueSheetsImport(tenantId, "superadmin-user-id");
    assert.equal(request.status, "pending");
    assert.equal(request.tenantId, tenantId);
    assert.equal(request.entities, null);

    const { rows } = await rawPool.query("SELECT status, tenant_id, requested_by FROM sheets_import_requests WHERE id = $1", [
      request.id,
    ]);
    assert.equal(rows.length, 1, "must actually be in Postgres, not just returned in memory");
    assert.equal(rows[0].status, "pending");
    assert.equal(rows[0].tenant_id, tenantId);
    assert.equal(rows[0].requested_by, "superadmin-user-id");
  } finally {
    await rawPool.query("DELETE FROM sheets_import_requests WHERE tenant_id = $1", [tenantId]);
    await rawPool.end();
  }
});

test("listTenantImportStatuses counts per-tenant Postgres-authoritative entities and finds the latest request, without mixing tenants", { skip }, async () => {
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? pgModule;
  const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });
  const { enqueueSheetsImport, listTenantImportStatuses } = await import("../src/lib/sheetsImport.ts");

  const tenantA = "status-test-A-" + Date.now();
  const tenantB = "status-test-B-" + Date.now();

  try {
    await rawPool.query("DELETE FROM entity_cutover_flags WHERE entity_name IN ('bot_settings', 'custom_commands')");
    await rawPool.query(
      "INSERT INTO entity_cutover_flags (entity_name, tenant_id, use_db) VALUES ('bot_settings', $1, true), ('custom_commands', $1, true)",
      [tenantA]
    );
    const req = await enqueueSheetsImport(tenantA, "tester");

    const statuses = await listTenantImportStatuses([tenantA, tenantB]);

    const a = statuses.get(tenantA);
    assert.ok(a);
    assert.equal(a.postgresEntityCount, 2, "tenant A has 2 entities flipped on");
    assert.ok(a.totalEntityCount > 2);
    assert.equal(a.latestRequest?.id, req.id);

    const b = statuses.get(tenantB);
    assert.ok(b);
    assert.equal(b.postgresEntityCount, 0, "tenant B must be unaffected by tenant A's flags");
    assert.equal(b.latestRequest, null);
  } finally {
    await rawPool.query("DELETE FROM entity_cutover_flags WHERE entity_name IN ('bot_settings', 'custom_commands')");
    await rawPool.query("DELETE FROM sheets_import_requests WHERE tenant_id IN ($1, $2)", [tenantA, tenantB]);
    await rawPool.end();
  }
});

test("listRecentSheetsImportRequests orders newest first", { skip }, async () => {
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? pgModule;
  const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });
  const { enqueueSheetsImport, listRecentSheetsImportRequests } = await import("../src/lib/sheetsImport.ts");

  const tenantId = "order-test-" + Date.now();
  try {
    const first = await enqueueSheetsImport(tenantId, "tester");
    await rawPool.query("UPDATE sheets_import_requests SET requested_at = now() - interval '1 hour' WHERE id = $1", [first.id]);
    const second = await enqueueSheetsImport(tenantId, "tester");

    const recent = await listRecentSheetsImportRequests(500);
    const ids = recent.map((r) => r.id);
    assert.ok(ids.indexOf(second.id) < ids.indexOf(first.id), "the more recently requested row must come first");
  } finally {
    await rawPool.query("DELETE FROM sheets_import_requests WHERE tenant_id = $1", [tenantId]);
    await rawPool.end();
  }
});
