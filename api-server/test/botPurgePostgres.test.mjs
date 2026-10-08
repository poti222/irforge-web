/**
 * test/botPurgePostgres.test.mjs — لایوباگ ۲۰۲۶-۱۰-۰۸: «وقتی ادمین بات‌ها رو پاک می‌کنه شیتِ اون بات پاک نمیشه».
 * بات‌هایِ cut-over‌شده داده‌شان در Postgres است (tenant_id = spreadsheet_id)؛ purge فقط شیت را ریست می‌کرد.
 * اینجا `purgeTenantPostgresData` روی Postgres واقعی (BUSINESS_DATABASE_URL) اجرا می‌شود: همه‌ی ردیف‌هایِ آن tenant
 * (و پرچم‌هایِ cutover) پاک می‌شوند و tenantِ دیگر دست‌نخورده می‌ماند.
 */
process.env.BOT_TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
process.env.REGISTRY_SPREADSHEET_ID ??= "sheet-registry";
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/testdb";

import { test } from "node:test";
import assert from "node:assert/strict";

const BIZ_URL = process.env.BUSINESS_DATABASE_URL;
const live = { skip: BIZ_URL ? false : "BUSINESS_DATABASE_URL تنظیم نشده" };
const pgMod = await import("pg");
const Pool = pgMod.default?.Pool ?? pgMod.Pool;

const A = `purge-a-${Math.random().toString(36).slice(2, 8)}`;
const B = `purge-b-${Math.random().toString(36).slice(2, 8)}`;

test("purgeTenantPostgresData deletes only the target tenant's rows", live, async () => {
  const biz = new Pool({ connectionString: BIZ_URL, max: 2 });
  try {
    const { purgeTenantPostgresData } = await import("../src/lib/botPurge.ts");
    for (const t of [A, B]) {
      await biz.query("INSERT INTO panels (tenant_id, id) VALUES ($1, 'p1')", [t]);
      await biz.query("INSERT INTO bot_settings (tenant_id, id, value) VALUES ($1, 'k', '{}'::jsonb)", [t]);
      await biz.query("INSERT INTO entity_cutover_flags (entity_name, tenant_id, use_db) VALUES ('panels', $1, true)", [t]);
    }
    const n = await purgeTenantPostgresData(A);
    assert.ok(n >= 3, `expected >=3 rows deleted, got ${n}`);
    for (const tbl of ["panels", "bot_settings", "entity_cutover_flags"]) {
      const a = await biz.query(`SELECT count(*)::int AS n FROM ${tbl} WHERE tenant_id = $1`, [A]);
      const b = await biz.query(`SELECT count(*)::int AS n FROM ${tbl} WHERE tenant_id = $1`, [B]);
      assert.equal(a.rows[0].n, 0, `${tbl} rows for A remain`);
      assert.equal(b.rows[0].n, 1, `${tbl} rows for B must survive`);
    }
  } finally {
    for (const tbl of ["panels", "bot_settings", "entity_cutover_flags"]) {
      await biz.query(`DELETE FROM ${tbl} WHERE tenant_id = ANY($1)`, [[A, B]]).catch(() => undefined);
    }
    await biz.end();
  }
});
