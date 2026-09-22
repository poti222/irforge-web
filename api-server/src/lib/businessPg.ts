/**
 * businessPg.ts — TS mirror of `bot/utils/business_repository.py`'s
 * `PostgresEntityRepository` + `ENTITY_SCHEMAS`, for the website side of
 * the PHASE 17 cutover.
 *
 * Why this exists: once a tenant's entity flips to Postgres
 * (`entity_cutover_flags`), the bot stops reading that entity from Google
 * Sheets — but until now, `botConfig.ts`'s generic `listEntity`/`getEntity`/
 * `putEntity` primitives only ever knew how to talk to Sheets, so every
 * route that writes through them called `assertSheetsAuthoritative()` and
 * just 409'd for a cut-over tenant. That's *safe* (a loud error beats a
 * write that silently never reaches the bot), but it also means the
 * website simply cannot edit that entity anymore for that tenant — live
 * bug: a bot already cut over for `panels` kept accepting "saved
 * successfully" panel edits from the site, which the site wrote to
 * Sheets... and the bot, reading only Postgres now, never saw.
 *
 * This file is the other half: real Postgres read/write, scoped to
 * exactly the entities registered below — today just `panels`, the one
 * behind that bug report (see PROGRESS.md). Adding another entity is one
 * more `ENTITY_SCHEMAS` entry, copied verbatim from that Python file's own
 * `EntitySchema` for it and the matching `bot/migrations/sql/00NN_<entity>.sql`
 * column list — not a guess, and not done speculatively for entities
 * nothing here has verified against.
 *
 * RLS: every PHASE 17 table has FORCE ROW LEVEL SECURITY
 * (`bot/migrations/sql/0028_row_level_security.sql`), gated on
 * `current_setting('app.tenant_id', true) = tenant_id`. That setting is
 * transaction-scoped (`SET LOCAL`), not connection-scoped — this pool hands
 * out connections that already served some other tenant's request, so a
 * plain `SET` would leak context across requests. `withTenantTx()` below is
 * the ONLY place a client is checked out; every exported function goes
 * through it, mirroring `bot/utils/db_business.py::_cursor()` exactly
 * (`SET LOCAL app.tenant_id = $1` as the transaction's first statement).
 * Getting this wrong can't leak another tenant's rows (FORCE RLS + an unset
 * setting just matches zero rows), it can only make reads/writes silently
 * see nothing — still worth getting right the first time.
 */
import type { PoolClient } from "pg";
import { getBusinessPool } from "./businessDbPool.js";

type EntitySchema = {
  table: string;
  /** Typed columns, in the order bot/migrations/sql/00NN_<entity>.sql declares them. Empty when kvMode. */
  columns: string[];
  /** Subset of `columns` that are JSONB — must be JSON.stringify'd on write; pg parses them back to JS on read automatically. */
  jsonbColumns: string[];
  /** Generic single `value JSONB` column table (bot_settings-shaped) instead of typed columns. */
  kvMode: boolean;
  /** This entity's own dataclass carries an `id` field equal to the row key (Panel.id, Form.id, ...) — echo the row key back under "id" in the reconstructed value, matching PostgresEntityRepository._row_to_value. */
  includeIdInValue: boolean;
  /** Column name for the row's own bookkeeping updated-at timestamp, when the entity's OWN domain field already owns `updated_at` (Panel does). */
  rowUpdatedAtCol: string;
};

// ─── registered entities ────────────────────────────────────────────────────
//
// Mirrors bot/utils/business_repository.py's `register_entity_schema(EntitySchema(entity_name="panels", ...))`
// and bot/migrations/sql/0005_panels.sql. `is_published`/`config_version`
// (added later by 0026_new_typed_columns.sql) are deliberately left out —
// bot/models.py::Panel has no such fields, so Panel.to_dict() never
// populates them and the bot's own writes never touch them either; nothing
// on either side reads them today.
const ENTITY_SCHEMAS: Record<string, EntitySchema> = {
  panels: {
    table: "panels",
    columns: [
      "title", "type", "content", "media_file_id", "buttons", "settings",
      "children", "parent_id", "is_home", "is_active", "created_at", "updated_at",
    ],
    jsonbColumns: ["buttons", "settings", "children"],
    kvMode: false,
    includeIdInValue: true,
    rowUpdatedAtCol: "row_updated_at",
  },
};

export function isKnownPgEntity(entity: string): boolean {
  return entity in ENTITY_SCHEMAS;
}

function schemaFor(entity: string): EntitySchema {
  const s = ENTITY_SCHEMAS[entity];
  if (!s) throw new Error(`businessPg: '${entity}' has no registered Postgres schema.`);
  return s;
}

async function withTenantTx<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getBusinessPool();
  if (!pool) throw new Error("BUSINESS_DATABASE_URL is not configured — cannot reach Postgres business data.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // نه `SET LOCAL app.tenant_id = $1` — گرامرِ دستورِ SET یک پارامترِ واقعیِ
    // extended-protocol را در آن موضع قبول نمی‌کند (برخلافِ psycopg2ی بات که
    // با `%s` این را سمتِ کلاینت جایگزین می‌کند، نه با یک bind parameterِ
    // واقعیِ سمتِ سرور). `set_config(...)` یک فراخوانیِ تابعِ معمولی است، پس
    // `$1` همان‌جا واقعاً bind می‌شود؛ آرگومانِ سومِ `true` یعنی transaction-
    // local، دقیقاً معادلِ همان SET LOCAL.
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // اتصال احتمالاً همین الان مرده — چیزی برای rollback نمانده.
    }
    throw err;
  } finally {
    client.release();
  }
}

function selectColsSql(s: EntitySchema): string {
  return s.kvMode ? "value" : s.columns.join(", ");
}

function rowToValue(s: EntitySchema, row: Record<string, unknown>): unknown {
  if (s.kvMode) return row.value;
  const out: Record<string, unknown> = {};
  for (const c of s.columns) out[c] = row[c];
  if (s.includeIdInValue) out.id = row.id;
  return out;
}

function wrapForColumn(s: EntitySchema, col: string, value: unknown): unknown {
  return s.jsonbColumns.includes(col) ? JSON.stringify(value) : value;
}

export type PgEntityRow = { key: string; value: unknown };

export async function pgListEntity(tenantId: string, entity: string): Promise<PgEntityRow[]> {
  const s = schemaFor(entity);
  return withTenantTx(tenantId, async (client) => {
    const { rows } = await client.query<Record<string, unknown>>(
      `SELECT id, ${selectColsSql(s)} FROM ${s.table} WHERE tenant_id = $1`,
      [tenantId]
    );
    return rows.map((r: Record<string, unknown>) => ({ key: r.id as string, value: rowToValue(s, r) }));
  });
}

export async function pgGetEntity(tenantId: string, entity: string, key: string): Promise<unknown | null> {
  const s = schemaFor(entity);
  return withTenantTx(tenantId, async (client) => {
    const { rows } = await client.query<Record<string, unknown>>(
      `SELECT id, ${selectColsSql(s)} FROM ${s.table} WHERE tenant_id = $1 AND id = $2`,
      [tenantId, key]
    );
    return rows.length ? rowToValue(s, rows[0]) : null;
  });
}

/**
 * Upsert یک ردیف — آینه‌ی PostgresEntityRepository._upsert. فقط ستون‌هایی
 * نوشته می‌شوند که در `value` حاضرند (نه `undefined`/`null`)؛ بقیه با
 * DEFAULT ستون خودشان پر می‌مانند (همان قراردادِ Sheets: کلیدِ غایب یعنی
 * پیش‌فرض) — عمداً همان رفتار پایتون، حتی برای فیلدهایی مثل `parent_id` که
 * یعنی «پاک‌کردنِ صریحِ والد با null» با یک upsert جزئی اثر نمی‌کند؛
 * صداکننده‌ها (بات و این فایل، هر دو) همیشه dict/آبجکتِ کامل می‌فرستند، نه
 * patch جزئی.
 */
async function upsertOne(client: PoolClient, s: EntitySchema, tenantId: string, key: string, value: unknown): Promise<void> {
  if (s.kvMode) {
    await client.query(
      `INSERT INTO ${s.table} (tenant_id, id, value) VALUES ($1, $2, $3) ` +
        `ON CONFLICT (tenant_id, id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [tenantId, key, JSON.stringify(value ?? null)]
    );
    return;
  }
  const v = (value ?? {}) as Record<string, unknown>;
  const cols = s.columns.filter((c) => v[c] !== undefined && v[c] !== null);
  if (cols.length === 0) {
    await client.query(
      `INSERT INTO ${s.table} (tenant_id, id) VALUES ($1, $2) ` +
        `ON CONFLICT (tenant_id, id) DO UPDATE SET ${s.rowUpdatedAtCol} = now()`,
      [tenantId, key]
    );
    return;
  }
  const placeholders = cols.map((_, i) => `$${i + 3}`).join(", ");
  const updateClause = cols.map((c) => `${c} = EXCLUDED.${c}`).join(", ");
  const params = [tenantId, key, ...cols.map((c) => wrapForColumn(s, c, v[c]))];
  await client.query(
    `INSERT INTO ${s.table} (tenant_id, id, ${cols.join(", ")}) VALUES ($1, $2, ${placeholders}) ` +
      `ON CONFLICT (tenant_id, id) DO UPDATE SET ${updateClause}, ${s.rowUpdatedAtCol} = now()`,
    params
  );
}

export async function pgSetEntity(tenantId: string, entity: string, key: string, value: unknown): Promise<void> {
  const s = schemaFor(entity);
  await withTenantTx(tenantId, (client) => upsertOne(client, s, tenantId, key, value));
}

/** چند ردیف در یک تراکنش — برخلاف Sheets (که هر upsertRow یک HTTP call جداست)، اینجا اتمیک هم هست. */
export async function pgSetEntities(
  tenantId: string,
  entity: string,
  entries: Array<{ key: string; value: unknown }>
): Promise<void> {
  const s = schemaFor(entity);
  await withTenantTx(tenantId, async (client) => {
    for (const e of entries) await upsertOne(client, s, tenantId, e.key, e.value);
  });
}

export async function pgDeleteEntity(tenantId: string, entity: string, key: string): Promise<boolean> {
  const s = schemaFor(entity);
  return withTenantTx(tenantId, async (client) => {
    const res = await client.query(`DELETE FROM ${s.table} WHERE tenant_id = $1 AND id = $2`, [tenantId, key]);
    return (res.rowCount ?? 0) > 0;
  });
}

export const __testables = { ENTITY_SCHEMAS, rowToValue, wrapForColumn };
