/**
 * test/botDatabase.test.mjs — IRFORGE_PAID_SQL_DATABASE_PROMPT
 *
 * ادعاها:
 *   ۱. هر سه روت جدید (GET/POST activate-sql/POST revert-to-sheets) واقعاً
 *      پشتِ `requireBotOwnership` هستند — همان سبکِ source-check که
 *      sheetsImport.test.mjs استفاده می‌کند.
 *   ۲. `computeBotDatabaseMode` (تابعِ خالصِ زیرِ getBotDatabaseStatus) وقتی
 *      cutover-status اصلاً در دسترس نیست (totalEntityCount=0 — pool در
 *      دسترس نیست، نه اینکه ۰ entity وجود دارد) باتِ هنوز-مهاجرت-نکرده را
 *      "sql" گزارش نمی‌کند؛ باید "sheets" بماند. این رگرسیونِ یک باگِ واقعی
 *      است که با تست دستی کشف شد: `postgresEntityCount >= totalEntityCount`
 *      با هر دو صفر true می‌شد.
 *   ۳. `getBotDatabaseStatus` با تمامِ entityها cutover‌شده (و pool واقعاً در
 *      دسترس) → "sql"، و با درخواستِ import/export در حالِ اجرا →
 *      "migrating"/"reverting"، درست تشخیص می‌دهد.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.BOT_TOKEN_ENCRYPTION_KEY ??= "d".repeat(64);
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

const __dirname = dirname(fileURLToPath(import.meta.url));
const routeSource = readFileSync(join(__dirname, "../src/routes/bots.ts"), "utf-8");

test("GET /bots/:botId/database is gated by requireBotOwnership", () => {
  const guard = routeSource.match(/router\.get\(\s*"\/bots\/:botId\/database"\s*,\s*requireBotOwnership/);
  assert.ok(guard, "the status route must list requireBotOwnership as middleware");
});

test("POST /bots/:botId/database/activate-sql is gated by requireBotOwnership", () => {
  const guard = routeSource.match(/router\.post\(\s*"\/bots\/:botId\/database\/activate-sql"\s*,\s*requireBotOwnership/);
  assert.ok(guard, "the activate-sql route must list requireBotOwnership as middleware");
});

test("POST /bots/:botId/database/revert-to-sheets is gated by requireBotOwnership", () => {
  const guard = routeSource.match(/router\.post\(\s*"\/bots\/:botId\/database\/revert-to-sheets"\s*,\s*requireBotOwnership/);
  assert.ok(guard, "the revert-to-sheets route must list requireBotOwnership as middleware");
});

test("activate-sql rejects a bot with no sheet before charging the wallet", () => {
  const section = routeSource.slice(routeSource.indexOf('"/bots/:botId/database/activate-sql"'));
  const guardIdx = section.search(/if \(!bot\.sheetId\)/);
  const walletIdx = section.indexOf("deductWallet");
  assert.ok(guardIdx >= 0 && guardIdx < walletIdx, "sheetId check must run before deductWallet");
});

test("SQL_DATABASE_MONTHLY_PRICE_TOMAN is 140,000 Toman", async () => {
  const { SQL_DATABASE_MONTHLY_PRICE_TOMAN } = await import("../src/lib/botDatabase.ts");
  assert.equal(SQL_DATABASE_MONTHLY_PRICE_TOMAN, 140_000);
});

// ─── computeBotDatabaseMode — pure, no Postgres needed ──────────────────────

test("computeBotDatabaseMode: 0/0 (cutover pool unreachable, both counts fail open to zero) → 'sheets', never 'sql'", async () => {
  const { computeBotDatabaseMode } = await import("../src/lib/botDatabase.ts");
  assert.equal(computeBotDatabaseMode(0, 0, false, false), "sheets");
});

test("computeBotDatabaseMode: full count on a real total → 'sql'", async () => {
  const { computeBotDatabaseMode } = await import("../src/lib/botDatabase.ts");
  assert.equal(computeBotDatabaseMode(83, 83, false, false), "sql");
});

test("computeBotDatabaseMode: partial count on a real total → 'sheets'", async () => {
  const { computeBotDatabaseMode } = await import("../src/lib/botDatabase.ts");
  assert.equal(computeBotDatabaseMode(40, 83, false, false), "sheets");
});

test("computeBotDatabaseMode: export in flight wins over import in flight", async () => {
  const { computeBotDatabaseMode } = await import("../src/lib/botDatabase.ts");
  assert.equal(computeBotDatabaseMode(83, 83, true, true), "reverting");
});

// ─── getBotDatabaseStatus — real Postgres, end-to-end mode computation ──────

const skip = !process.env.BUSINESS_DATABASE_URL && "no live BUSINESS_DATABASE_URL configured in this environment";

test("getBotDatabaseStatus: a tenant nobody has ever touched, with a live pool → 'sheets' with the real 83-entity total", { skip }, async () => {
  const { getBotDatabaseStatus } = await import("../src/lib/botDatabase.ts");
  const { CUTOVER_ENTITIES } = await import("../src/lib/cutoverEntities.ts");
  const tenantId = "botdb-fresh-" + Date.now();

  const status = await getBotDatabaseStatus(tenantId, null);
  assert.equal(status.totalEntityCount, CUTOVER_ENTITIES.length, "a live pool always knows the full entity count");
  assert.equal(status.postgresEntityCount, 0);
  assert.equal(status.mode, "sheets");
});

test("getBotDatabaseStatus: every entity cutover for the tenant → mode 'sql'", { skip }, async () => {
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? pgModule;
  const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });
  const { getBotDatabaseStatus } = await import("../src/lib/botDatabase.ts");
  const { CUTOVER_ENTITIES } = await import("../src/lib/cutoverEntities.ts");

  const tenantId = "botdb-full-" + Date.now();
  try {
    const values = CUTOVER_ENTITIES.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2}, true)`).join(", ");
    const params = CUTOVER_ENTITIES.flatMap((e) => [e, tenantId]);
    await rawPool.query(`INSERT INTO entity_cutover_flags (entity_name, tenant_id, use_db) VALUES ${values}`, params);

    const status = await getBotDatabaseStatus(tenantId, new Date(Date.now() + 86400_000));
    assert.equal(status.postgresEntityCount, CUTOVER_ENTITIES.length);
    assert.equal(status.mode, "sql");
  } finally {
    await rawPool.query("DELETE FROM entity_cutover_flags WHERE tenant_id = $1", [tenantId]);
    await rawPool.end();
  }
});

test("getBotDatabaseStatus: an in-flight import request → mode 'migrating'", { skip }, async () => {
  const { getBotDatabaseStatus } = await import("../src/lib/botDatabase.ts");
  const { enqueueSheetsImport } = await import("../src/lib/sheetsImport.ts");
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? pgModule;
  const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });

  const tenantId = "botdb-migrating-" + Date.now();
  try {
    await enqueueSheetsImport(tenantId, "tester");
    const status = await getBotDatabaseStatus(tenantId, null);
    assert.equal(status.mode, "migrating");
  } finally {
    await rawPool.query("DELETE FROM sheets_import_requests WHERE tenant_id = $1", [tenantId]);
    await rawPool.end();
  }
});

test("getBotDatabaseStatus: an in-flight export request → mode 'reverting'", { skip }, async () => {
  const { getBotDatabaseStatus } = await import("../src/lib/botDatabase.ts");
  const { enqueueSheetsExport } = await import("../src/lib/sheetsExport.ts");
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? pgModule;
  const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });

  const tenantId = "botdb-reverting-" + Date.now();
  try {
    await enqueueSheetsExport(tenantId, "tester");
    const status = await getBotDatabaseStatus(tenantId, null);
    assert.equal(status.mode, "reverting");
  } finally {
    await rawPool.query("DELETE FROM sheets_export_requests WHERE tenant_id = $1", [tenantId]);
    await rawPool.end();
  }
});
