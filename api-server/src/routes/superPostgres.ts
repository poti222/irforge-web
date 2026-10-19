/**
 * routes/superPostgres.ts — بخشِ «دیتابیس Postgres» در /super (فقط سوپرادمین + رمزِ دومِ /super).
 * ─────────────────────────────────────────────────────────────────────────────
 * دو دیتابیس:
 *   main     → دیتابیسِ خودِ سایت (DATABASE_URL): کاربران، بات‌ها، مدارس، پرداخت‌ها …
 *   business → دیتابیسِ دیتای بات‌ها (BUSINESS_DATABASE_URL): هر tenant (= sheetId) با RLS جدا؛
 *              برای دیدنِ/ویرایشِ ردیف‌ها باید یک tenant (بات) انتخاب شود.
 *
 *   GET    /super/pg/databases
 *   GET    /super/pg/business/tenants
 *   GET    /super/pg/:db/tables                       فهرستِ جدول‌ها (گروه‌بندی، حجم، تخمینِ ردیف)
 *   GET    /super/pg/:db/tables/:table                ستون‌ها/کلیدها
 *   GET    /super/pg/:db/tables/:table/rows           صفحه‌بندی + جستجو + مرتب‌سازی
 *   POST   /super/pg/:db/tables/:table/rows           درج
 *   PATCH  /super/pg/:db/tables/:table/rows           ویرایش (با کلیدِ اصلی)
 *   DELETE /super/pg/:db/tables/:table/rows           حذف (با کلیدِ اصلی)
 *   POST   /super/pg/:db/query                        کنسولِ SQL (پیش‌فرض فقط‌خواندنی)
 *
 * ایمنی: نامِ جدول/ستون فقط از فهرستِ واقعیِ DB پذیرفته می‌شود؛ مقدارها همیشه پارامتر هستند؛
 * ستون‌هایِ حساس (token/password/hash/…) در خودِ SQL ماسک می‌شوند و هرگز از DB خارج نمی‌شوند؛
 * هر نوشتن در admin_audit_log ثبت می‌شود؛ ویرایش/حذف باید دقیقاً ۱ ردیف را بگیرد وگرنه rollback.
 */
import { Router } from "express";
import type { Pool, PoolClient } from "pg";
import { pool as mainPool, db, botsTable } from "@workspace/db";
import { requireSuperAdmin } from "./auth";
import { requireSuperGate } from "../middleware/superGate";
import { getBusinessPool } from "../lib/businessDbPool.js";
import { writeAudit } from "../lib/audit.js";
import { logger } from "../lib/logger";
import {
  buildOrderBy,
  buildSearchWhere,
  classifyTable,
  coerceValue,
  isReadQuery,
  isSensitiveColumn,
  normalizeSingleStatement,
  quoteIdent,
  type ColumnInfo,
} from "../lib/superPg.js";

const router = Router();
const guard = [requireSuperAdmin, requireSuperGate] as const;

type DbId = "main" | "business";

function poolFor(id: string): Pool | null {
  if (id === "main") return mainPool as unknown as Pool;
  if (id === "business") return getBusinessPool();
  return null;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** یک کلاینت با تراکنش؛ tenant (برای RLSِ business) و statement_timeout ست می‌شود. */
async function withTx<T>(
  dbId: string,
  opts: { tenant?: string | null; readOnly?: boolean; timeoutMs?: number },
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = poolFor(dbId);
  if (!pool) throw new HttpError(dbId === "business" ? 503 : 404, dbId === "business" ? "BUSINESS_DATABASE_URL تنظیم نشده" : "دیتابیس نامعتبر");
  const client = await pool.connect();
  try {
    await client.query(opts.readOnly ? "BEGIN READ ONLY" : "BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${Math.max(1000, Math.min(opts.timeoutMs ?? 8000, 30000))}`);
    if (opts.tenant) await client.query("SELECT set_config('app.tenant_id', $1, true)", [opts.tenant]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection gone */
    }
    throw err;
  } finally {
    client.release();
  }
}

function sendError(res: any, err: any, fallback: string) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  // خطاهای Postgres برای سوپرادمین مفیدند (نقضِ constraint، timeout، …)
  if (err && typeof err.code === "string" && /^[0-9A-Z]{5}$/.test(err.code)) {
    const msg = err.code === "57014" ? "اجرا بیش از حدِ مجاز طول کشید (timeout)" : err.message;
    return res.status(400).json({ error: msg, code: err.code, detail: err.detail ?? undefined });
  }
  logger.error({ err }, fallback);
  return res.status(500).json({ error: fallback });
}

async function loadTables(c: PoolClient): Promise<string[]> {
  const { rows } = await c.query<{ name: string }>(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p') ORDER BY c.relname`,
  );
  return rows.map((r) => r.name);
}

async function loadColumns(c: PoolClient, table: string): Promise<ColumnInfo[]> {
  const { rows } = await c.query(
    `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, t.typname AS udt,
            NOT a.attnotnull AS nullable, (d.adbin IS NOT NULL) AS has_default,
            COALESCE(a.attnum = ANY(pk.conkey), false) AS is_pk,
            (a.attidentity <> '') AS is_identity, (a.attgenerated <> '') AS is_generated
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_type t ON t.oid = a.atttypid
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       LEFT JOIN pg_constraint pk ON pk.conrelid = a.attrelid AND pk.contype = 'p'
      WHERE n.nspname = 'public' AND c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`,
    [table],
  );
  return rows.map((r: any) => ({
    name: r.name,
    type: r.type,
    udt: r.udt,
    nullable: r.nullable,
    hasDefault: r.has_default,
    isPk: r.is_pk,
    isIdentity: r.is_identity,
    isGenerated: r.is_generated,
  }));
}

/** جدول باید واقعاً وجود داشته باشد (whitelist)؛ ستون‌ها را هم برمی‌گرداند. */
async function resolveTable(c: PoolClient, table: string) {
  const tables = await loadTables(c);
  if (!tables.includes(table)) throw new HttpError(404, "جدول پیدا نشد");
  const cols = await loadColumns(c, table);
  const hasTenant = cols.some((x) => x.name === "tenant_id");
  const pkCols = cols.filter((x) => x.isPk);
  const editable = pkCols.length > 0 && !pkCols.some((x) => isSensitiveColumn(x.name));
  return { cols, hasTenant, pkCols, editable };
}

function requireTenant(dbId: string, hasTenant: boolean, tenant: string | undefined | null) {
  if (dbId === "business" && hasTenant && !tenant) {
    throw new HttpError(400, "برای این جدول اول یک بات (tenant) را انتخاب کن");
  }
}

/** ستون‌ها برای SELECT: حساس‌ها ماسک، bytea خلاصه — همه در SQL، تا مقدارِ واقعی هرگز بیرون نیاید. */
function selectList(cols: ColumnInfo[]): string {
  return cols
    .map((c) => {
      const q = quoteIdent(c.name);
      if (isSensitiveColumn(c.name)) return `CASE WHEN ${q} IS NULL THEN NULL ELSE '••••••••' END AS ${q}`;
      if (c.udt === "bytea") return `CASE WHEN ${q} IS NULL THEN NULL ELSE '<binary ' || octet_length(${q}) || ' bytes>' END AS ${q}`;
      return q;
    })
    .join(", ");
}

function pkFromBody(pkCols: ColumnInfo[], pk: any): unknown[] {
  if (!pk || typeof pk !== "object") throw new HttpError(400, "کلید اصلیِ ردیف لازم است");
  return pkCols.map((c) => {
    if (!(c.name in pk)) throw new HttpError(400, `مقدارِ کلیدِ ${c.name} لازم است`);
    return pk[c.name];
  });
}

function writableValues(cols: ColumnInfo[], values: any): { col: ColumnInfo; value: unknown }[] {
  if (!values || typeof values !== "object") throw new HttpError(400, "values لازم است");
  const out: { col: ColumnInfo; value: unknown }[] = [];
  for (const [name, raw] of Object.entries(values)) {
    const col = cols.find((c) => c.name === name);
    if (!col) throw new HttpError(400, `ستونِ ناشناس: ${name}`);
    if (isSensitiveColumn(name)) throw new HttpError(403, `ستونِ ${name} حساس است و از این‌جا قابل‌ویرایش نیست`);
    if (col.isGenerated) throw new HttpError(400, `ستونِ ${name} محاسبه‌شده است`);
    out.push({ col, value: coerceValue(col, raw) });
  }
  return out;
}

function auditValues(items: { col: ColumnInfo; value: unknown }[]) {
  return Object.fromEntries(items.map((i) => [i.col.name, typeof i.value === "string" ? i.value.slice(0, 200) : i.value]));
}

// ─── فهرستِ دیتابیس‌ها ─────────────────────────────────────────────────────

router.get("/super/pg/databases", ...guard, (_req, res) => {
  res.json({
    databases: [
      { id: "main", label: "دیتابیسِ سایت", description: "کاربران، ربات‌ها، مدارس، پرداخت‌ها، تنظیمات", available: true },
      {
        id: "business",
        label: "دیتابیسِ دیتای ربات‌ها",
        description: "دیتای هر ربات (tenant) — برای دیدن، یک ربات را انتخاب کن",
        available: !!process.env.BUSINESS_DATABASE_URL,
      },
    ],
  });
});

router.get("/super/pg/business/tenants", ...guard, async (_req, res) => {
  try {
    const rows = await db.select({ id: botsTable.id, name: botsTable.name, sheetId: botsTable.sheetId, status: botsTable.status }).from(botsTable);
    res.json({ tenants: rows.filter((r) => !!r.sheetId).map((r) => ({ botId: r.id, name: r.name, tenant: r.sheetId, status: r.status })) });
  } catch (err) {
    sendError(res, err, "Failed to list tenants");
  }
});

// ─── جدول‌ها ───────────────────────────────────────────────────────────────

router.get("/super/pg/:db/tables", ...guard, async (req, res) => {
  try {
    const out = await withTx(String(req.params.db), { readOnly: true }, async (c) => {
      const { rows } = await c.query(
        `SELECT c.relname AS name, GREATEST(c.reltuples, 0)::bigint AS est, pg_total_relation_size(c.oid)::bigint AS bytes,
                c.relrowsecurity AS rls,
                EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary) AS has_pk,
                EXISTS (SELECT 1 FROM information_schema.columns ic
                         WHERE ic.table_schema = 'public' AND ic.table_name = c.relname AND ic.column_name = 'tenant_id') AS has_tenant
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r','p') ORDER BY c.relname`,
      );
      return rows.map((r: any) => {
        const g = classifyTable(r.name);
        return {
          name: r.name,
          group: g.id,
          groupFa: g.fa,
          groupOrder: g.order,
          estimatedRows: Number(r.est),
          bytes: Number(r.bytes),
          rls: r.rls,
          hasPk: r.has_pk,
          needsTenant: r.has_tenant,
        };
      });
    });
    res.json({ tables: out });
  } catch (err) {
    sendError(res, err, "Failed to list tables");
  }
});

router.get("/super/pg/:db/tables/:table", ...guard, async (req, res) => {
  try {
    const out = await withTx(String(req.params.db), { readOnly: true }, async (c) => {
      const t = await resolveTable(c, String(req.params.table));
      return {
        table: req.params.table,
        columns: t.cols.map((x) => ({ ...x, masked: isSensitiveColumn(x.name) })),
        needsTenant: t.hasTenant,
        editable: t.editable,
        primaryKey: t.pkCols.map((x) => x.name),
      };
    });
    res.json(out);
  } catch (err) {
    sendError(res, err, "Failed to read table schema");
  }
});

// ─── ردیف‌ها ───────────────────────────────────────────────────────────────

router.get("/super/pg/:db/tables/:table/rows", ...guard, async (req, res) => {
  try {
    const dbId = String(req.params.db);
    const tenant = typeof req.query.tenant === "string" && req.query.tenant ? req.query.tenant : null;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 200) : "";

    const out = await withTx(dbId, { readOnly: true, tenant, timeoutMs: 8000 }, async (c) => {
      const t = await resolveTable(c, String(req.params.table));
      requireTenant(dbId, t.hasTenant, tenant);
      const tbl = quoteIdent(String(req.params.table));
      const search = buildSearchWhere(t.cols, q, 1);
      const where = search ? `WHERE ${search.sql}` : "";
      const params = search ? search.params : [];
      const order = buildOrderBy(t.cols, typeof req.query.sort === "string" ? req.query.sort : undefined, typeof req.query.dir === "string" ? req.query.dir : undefined);

      let total: number | null = null;
      try {
        await c.query("SAVEPOINT cnt");
        await c.query("SET LOCAL statement_timeout = 3000");
        const cnt = await c.query<{ n: string }>(`SELECT count(*) AS n FROM ${tbl} ${where}`, params);
        total = Number(cnt.rows[0]!.n);
        await c.query("RELEASE SAVEPOINT cnt");
      } catch {
        await c.query("ROLLBACK TO SAVEPOINT cnt"); // شمارش گران بود؛ فقط بدونِ total ادامه می‌دهیم
      }
      await c.query("SET LOCAL statement_timeout = 8000");
      const data = await c.query(
        `SELECT ${selectList(t.cols)} FROM ${tbl} ${where} ${order} LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      return {
        rows: data.rows,
        total,
        limit,
        offset,
        columns: t.cols.map((x) => ({ ...x, masked: isSensitiveColumn(x.name) })),
        primaryKey: t.pkCols.map((x) => x.name),
        editable: t.editable,
        needsTenant: t.hasTenant,
      };
    });
    res.json(out);
  } catch (err) {
    sendError(res, err, "Failed to read rows");
  }
});

router.post("/super/pg/:db/tables/:table/rows", ...guard, async (req: any, res) => {
  try {
    const dbId = String(req.params.db);
    const table = String(req.params.table);
    const tenant = typeof req.body?.tenant === "string" && req.body.tenant ? req.body.tenant : null;
    const result = await withTx(dbId, { tenant, timeoutMs: 10000 }, async (c) => {
      const t = await resolveTable(c, table);
      requireTenant(dbId, t.hasTenant, tenant);
      const items = writableValues(t.cols, req.body?.values ?? {});
      if (dbId === "business" && t.hasTenant && tenant && !items.some((i) => i.col.name === "tenant_id")) {
        const tc = t.cols.find((x) => x.name === "tenant_id")!;
        items.push({ col: tc, value: tenant });
      }
      const tbl = quoteIdent(table);
      const sql =
        items.length === 0
          ? `INSERT INTO ${tbl} DEFAULT VALUES RETURNING ${selectList(t.cols)}`
          : `INSERT INTO ${tbl} (${items.map((i) => quoteIdent(i.col.name)).join(", ")}) VALUES (${items.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING ${selectList(t.cols)}`;
      const r = await c.query(sql, items.map((i) => i.value));
      return { row: r.rows[0], audit: auditValues(items) };
    });
    await writeAudit({
      actorUserId: req.userId,
      action: "super_pg_write",
      metadata: { db: dbId, table, op: "insert", tenant, values: result.audit },
    });
    res.status(201).json({ row: result.row });
  } catch (err) {
    sendError(res, err, "Failed to insert row");
  }
});

router.patch("/super/pg/:db/tables/:table/rows", ...guard, async (req: any, res) => {
  try {
    const dbId = String(req.params.db);
    const table = String(req.params.table);
    const tenant = typeof req.body?.tenant === "string" && req.body.tenant ? req.body.tenant : null;
    const result = await withTx(dbId, { tenant, timeoutMs: 10000 }, async (c) => {
      const t = await resolveTable(c, table);
      if (!t.editable) throw new HttpError(409, "این جدول کلیدِ اصلیِ قابل‌استفاده ندارد؛ ویرایشِ سطری ممکن نیست");
      requireTenant(dbId, t.hasTenant, tenant);
      const items = writableValues(t.cols, req.body?.values ?? {}).filter((i) => !i.col.isPk || req.body?.allowPkChange === true);
      if (items.length === 0) throw new HttpError(400, "چیزی برای ویرایش نیست");
      const pkVals = pkFromBody(t.pkCols, req.body?.pk);
      const sets = items.map((i, idx) => `${quoteIdent(i.col.name)} = $${idx + 1}`).join(", ");
      const wh = t.pkCols.map((pc, idx) => `${quoteIdent(pc.name)} = $${items.length + idx + 1}`).join(" AND ");
      const r = await c.query(`UPDATE ${quoteIdent(table)} SET ${sets} WHERE ${wh} RETURNING ${selectList(t.cols)}`, [...items.map((i) => i.value), ...pkVals]);
      if (r.rowCount !== 1) throw new HttpError(409, `ویرایش ${r.rowCount} ردیف را می‌گرفت (باید دقیقاً ۱ باشد)؛ لغو شد`);
      return { row: r.rows[0], audit: auditValues(items), pk: req.body.pk };
    });
    await writeAudit({
      actorUserId: req.userId,
      action: "super_pg_write",
      metadata: { db: dbId, table, op: "update", tenant, pk: result.pk, values: result.audit },
    });
    res.json({ row: result.row });
  } catch (err) {
    sendError(res, err, "Failed to update row");
  }
});

router.delete("/super/pg/:db/tables/:table/rows", ...guard, async (req: any, res) => {
  try {
    const dbId = String(req.params.db);
    const table = String(req.params.table);
    const tenant = typeof req.body?.tenant === "string" && req.body.tenant ? req.body.tenant : null;
    const pk = await withTx(dbId, { tenant, timeoutMs: 10000 }, async (c) => {
      const t = await resolveTable(c, table);
      if (!t.editable) throw new HttpError(409, "این جدول کلیدِ اصلیِ قابل‌استفاده ندارد؛ حذفِ سطری ممکن نیست");
      requireTenant(dbId, t.hasTenant, tenant);
      const pkVals = pkFromBody(t.pkCols, req.body?.pk);
      const wh = t.pkCols.map((pc, idx) => `${quoteIdent(pc.name)} = $${idx + 1}`).join(" AND ");
      const r = await c.query(`DELETE FROM ${quoteIdent(table)} WHERE ${wh}`, pkVals);
      if (r.rowCount !== 1) throw new HttpError(409, `حذف ${r.rowCount} ردیف را می‌گرفت (باید دقیقاً ۱ باشد)؛ لغو شد`);
      return req.body.pk;
    });
    await writeAudit({
      actorUserId: req.userId,
      action: "super_pg_write",
      metadata: { db: dbId, table, op: "delete", tenant, pk },
    });
    res.json({ deleted: true });
  } catch (err) {
    sendError(res, err, "Failed to delete row");
  }
});

// ─── کنسولِ SQL ────────────────────────────────────────────────────────────

router.post("/super/pg/:db/query", ...guard, async (req: any, res) => {
  try {
    const dbId = String(req.params.db);
    const tenant = typeof req.body?.tenant === "string" && req.body.tenant ? req.body.tenant : null;
    const norm = normalizeSingleStatement(String(req.body?.sql ?? ""));
    if (!norm.ok) throw new HttpError(400, norm.error);
    const write = req.body?.mode === "write";
    if (write && req.body?.confirm !== "WRITE") throw new HttpError(400, "برای اجرای نوشتن باید confirm: \"WRITE\" بفرستی");

    const started = Date.now();
    const out = await withTx(dbId, { tenant, readOnly: !write, timeoutMs: write ? 15000 : 8000 }, async (c) => {
      const readQuery = isReadQuery(norm.sql);
      const text = !write && readQuery ? `SELECT * FROM (${norm.sql}) AS _q LIMIT 501` : norm.sql;
      const r: any = await c.query(text);
      const rowsAll: any[] = Array.isArray(r.rows) ? r.rows : [];
      const cap = write ? 200 : 500;
      return {
        command: r.command as string,
        rowCount: r.rowCount as number | null,
        fields: (r.fields ?? []).map((f: any) => f.name as string),
        rows: rowsAll.slice(0, cap),
        truncated: rowsAll.length > cap,
      };
    });
    if (write) {
      await writeAudit({
        actorUserId: req.userId,
        action: "super_pg_write",
        metadata: { db: dbId, op: "sql", tenant, sql: norm.sql.slice(0, 2000), command: out.command, rowCount: out.rowCount },
      });
    }
    res.json({ ...out, ms: Date.now() - started });
  } catch (err) {
    sendError(res, err, "Query failed");
  }
});

export default router;
