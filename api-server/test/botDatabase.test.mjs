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

test("SQL_DATABASE_PRICE_TOMAN is 249,000 Toman, one-time (2026-09-23 pricing change)", async () => {
  const { SQL_DATABASE_PRICE_TOMAN } = await import("../src/lib/botDatabase.ts");
  assert.equal(SQL_DATABASE_PRICE_TOMAN, 249_000);
});

test("SQL_DATABASE_UNLIMITED_EXPIRY is genuinely far in the future (never satisfies an expiry sweep's <= now check)", async () => {
  const { SQL_DATABASE_UNLIMITED_EXPIRY } = await import("../src/lib/botDatabase.ts");
  assert.ok(SQL_DATABASE_UNLIMITED_EXPIRY.getTime() > Date.now() + 100 * 365 * 24 * 60 * 60 * 1000, "must be at least ~100 years out");
});

// ─── computeBotDatabaseMode — pure, no Postgres needed ──────────────────────

test("computeBotDatabaseMode: 0/0 (cutover pool unreachable, both counts fail open to zero), not purchased → 'sheets', never 'sql'", async () => {
  const { computeBotDatabaseMode } = await import("../src/lib/botDatabase.ts");
  assert.equal(computeBotDatabaseMode(0, 0, false, false, false), "sheets");
});

test("computeBotDatabaseMode: full count on a real total, not purchased (e.g. superadmin Sheets Import tool) → 'sql'", async () => {
  const { computeBotDatabaseMode } = await import("../src/lib/botDatabase.ts");
  assert.equal(computeBotDatabaseMode(83, 83, false, false, false), "sql");
});

test("computeBotDatabaseMode: partial count on a real total, not purchased → 'sheets'", async () => {
  const { computeBotDatabaseMode } = await import("../src/lib/botDatabase.ts");
  assert.equal(computeBotDatabaseMode(40, 83, false, false, false), "sheets");
});

test("computeBotDatabaseMode: export in flight wins over import in flight and over purchased", async () => {
  const { computeBotDatabaseMode } = await import("../src/lib/botDatabase.ts");
  assert.equal(computeBotDatabaseMode(83, 83, true, true, true), "reverting");
});

// 2026-09-23 pricing change: a one-time purchase covers every entity, so the
// site should say "sql" (no more payment needed) the moment billing clears
// -- not wait for every one of the ~90 entities to finish copying.
test("computeBotDatabaseMode: purchased with only a couple of entities migrated so far → 'sql' immediately, not 'sheets'/'migrating'", async () => {
  const { computeBotDatabaseMode } = await import("../src/lib/botDatabase.ts");
  assert.equal(computeBotDatabaseMode(2, 91, true, false, true), "sql");
});

test("computeBotDatabaseMode: purchased with zero entities migrated yet → still 'sql', not 'sheets'", async () => {
  const { computeBotDatabaseMode } = await import("../src/lib/botDatabase.ts");
  assert.equal(computeBotDatabaseMode(0, 91, true, false, true), "sql");
});

test("computeBotDatabaseMode: purchased wins over importInFlight (purchased is checked first)", async () => {
  const { computeBotDatabaseMode } = await import("../src/lib/botDatabase.ts");
  // اگر ترتیبِ چک‌ها عوض شود و importInFlight زودتر برگردد "migrating"،
  // این تست رد می‌شود -- دقیقاً همان رگرسیونی که این فاز قرار بود بسازد.
  assert.notEqual(computeBotDatabaseMode(2, 91, true, false, true), "migrating");
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

// 2026-09-23 pricing change: a paying tenant whose migration hasn't finished
// yet must show "sql" (paid, unlimited), not "migrating" -- with
// importInFlight/unlimited surfaced separately so the frontend can still
// show real progress underneath that "sql" status.
test("getBotDatabaseStatus: purchased (unlimited sentinel expiry) + an in-flight import → mode 'sql', unlimited true, importInFlight true", { skip }, async () => {
  const { getBotDatabaseStatus, SQL_DATABASE_UNLIMITED_EXPIRY } = await import("../src/lib/botDatabase.ts");
  const { enqueueSheetsImport } = await import("../src/lib/sheetsImport.ts");
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? pgModule;
  const rawPool = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });

  const tenantId = "botdb-purchased-migrating-" + Date.now();
  try {
    await enqueueSheetsImport(tenantId, "tester");
    const status = await getBotDatabaseStatus(tenantId, SQL_DATABASE_UNLIMITED_EXPIRY);
    assert.equal(status.mode, "sql", "purchased must win over an in-flight import for the display mode");
    assert.equal(status.unlimited, true);
    assert.equal(status.importInFlight, true);
    assert.equal(status.exportInFlight, false);
  } finally {
    await rawPool.query("DELETE FROM sheets_import_requests WHERE tenant_id = $1", [tenantId]);
    await rawPool.end();
  }
});

test("getBotDatabaseStatus: not purchased (null expiry) → unlimited false, importInFlight/exportInFlight false with no requests", { skip }, async () => {
  const { getBotDatabaseStatus } = await import("../src/lib/botDatabase.ts");
  const tenantId = "botdb-unpurchased-" + Date.now();
  const status = await getBotDatabaseStatus(tenantId, null);
  assert.equal(status.unlimited, false);
  assert.equal(status.importInFlight, false);
  assert.equal(status.exportInFlight, false);
});
