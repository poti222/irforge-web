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
 * exactly the entities registered below — `panels` (the one behind that
 * bug report, see PROGRESS.md) and now `forms` (same bug, reported live:
 * `POST/PATCH/DELETE /bots/:botId/forms/*` unconditionally called
 * `assertSheetsAuthoritative(FORMS_TAB)`, which 409s the instant a
 * tenant's `forms` cutover flag is on — completely blocking form edits
 * from the site for any tenant migrated via the self-serve SQL Database
 * purchase or the superadmin Sheets Import tool, with no data-loss risk
 * involved at all, just a route that never learned Postgres exists).
 * Adding another entity is one more `ENTITY_SCHEMAS` entry, copied
 * verbatim from that Python file's own `EntitySchema` for it and the
 * matching `bot/migrations/sql/00NN_<entity>.sql` column list — not a
 * guess, and not done speculatively for entities nothing here has
 * verified against.
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
  /**
   * ستون‌هایی که در دیتابیس NULL-پذیرند و `null` برایشان یک مقدارِ واقعی است («بدونِ والد»).
   * برای بقیه‌ی ستون‌ها `null` یعنی «ننویس» (ستون‌های NOT NULL با DEFAULT) — وگرنه INSERT می‌شکست.
   * بدونِ این، `parent_id: null` هرگز روی Postgres نوشته نمی‌شد و «رفعِ خودکار»/«جدا کردنِ فرزند»/حذفِ orphan
   * برای باتِ مهاجرت‌کرده بی‌اثر بود.
   */
  nullableColumns?: string[];
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
    nullableColumns: ["parent_id"],
  },
  // PHASE 17.6 on the bot side (business_repository.py). Form.id duplicates
  // the row key like Panel does (includeIdInValue), but unlike Panel, Form
  // has no `updated_at` domain field to collide with the generic bookkeeping
  // column — only `created_at` is a real string field, and that column is
  // never referenced by name here (INSERT relies on the table's own
  // `row_created_at DEFAULT now()`, this file's writes never touch it).
  // `thank_you_media_file_id`/`thank_you_media_type`/`thank_you_buttons`
  // (bot/migrations/sql/0038_forms_thank_you_media.sql) added alongside the
  // Postgres-cutover fix above, in the same pass — buttons reuse the exact
  // same shape as panels.buttons.
  forms: {
    table: "forms",
    columns: [
      "title", "fields", "destination_group", "destination_admin_ids",
      "thank_you_message", "thank_you_media_file_id", "thank_you_media_type",
      "thank_you_buttons", "is_active", "notify_admin", "allow_edit", "created_at",
    ],
    jsonbColumns: ["fields", "destination_admin_ids", "thank_you_buttons"],
    kvMode: false,
    includeIdInValue: true,
    rowUpdatedAtCol: "updated_at",
  },
  // PHASE 17.8 on the bot side. Live bug, 2026-09-23: the row key IS the
  // command name (no separate `id` field on the value — `command` is just
  // an ordinary column that happens to equal the key, same as
  // users.user_id), so includeIdInValue is NOT needed here, unlike
  // panels/forms. `order` (this repo's own newer reorder feature) is
  // deliberately NOT listed: it's not in the bot-side EntitySchema either,
  // so it would silently get dropped on every Postgres write anyway —
  // reordering degrades to the `effectiveOrder` created_at fallback for a
  // cut-over tenant rather than persisting, a known, narrow limitation
  // (not a data-loss or crash risk for anything else) left for a follow-up
  // migration rather than rushed in under this fix's own time pressure.
  custom_commands: {
    table: "custom_commands",
    // `source` (bot/migrations/sql/0039_custom_commands_source.sql): "custom" | "core" | "plugin:<id>". Without it here
    // every non-custom row this repo wrote for a cut-over tenant silently became source='custom' (the column default) —
    // the bot's CommandGateMiddleware never saw an owner's disable, and the Commands UI listed built-ins as custom.
    columns: ["command", "target", "description", "admin_only", "is_active", "created_at", "source"],
    jsonbColumns: [],
    kvMode: false,
    includeIdInValue: false,
    rowUpdatedAtCol: "updated_at",
  },
  // Live bug, 2026-10-06 (Noshazin): "کامندها رو از بات نمیگیره … تمامی اطلاعات باید از روی sql خونده بشه". The bot
  // already routes `bot_settings` to Postgres for that tenant (bot log: "cutover: 'bot_settings' now routing to
  // Postgres"), but this file never knew the entity, so `readSettings`/`patchSettings`/`getEntity(..."bot_settings")`
  // kept hitting Google Sheets: edits were invisible to the bot, reads were stale, and a few quick clicks exhausted
  // the Sheets read quota (HTTP 500 "Quota exceeded … Read requests per minute"). Registered as the same generic
  // kv_mode table the bot uses (bot/migrations/sql/0004_bot_settings.sql: id/tenant_id/value JSONB) — one row per
  // settings KEY (flat BotSettings fields + `__plugin_states__`, `payment_cfg`, `bot_commands`, …).
  bot_settings: {
    table: "bot_settings",
    columns: [],
    jsonbColumns: [],
    kvMode: true,
    includeIdInValue: false,
    rowUpdatedAtCol: "updated_at",
  },
  // Live bug, 2026-09-23: reported "an edit doesn't show up in the bot" for
  // the addresses (business-locations) plugin. Same class as panels/forms/
  // custom_commands above — bot/utils/business_repository.py registers
  // "addresses" as a plain kv_mode entity (one generic `value JSONB` column,
  // bot/migrations/sql/0030_phase2_remaining_entities.sql), but this file
  // never learned about it, so addressStore.ts's assertSheetsAuthoritative()
  // 409'd every write the instant a tenant's addresses cutover flag went on
  // (SQL Database purchase, Sheets Import, or the canary flag), while reads
  // stayed on stale Sheets data regardless (isKnownPgEntity was always
  // false). kvMode needs no `columns`/`jsonbColumns` — rowToValue/upsertOne
  // already branch on it generically; this is the first kv_mode entry this
  // file has ever needed.
  addresses: {
    table: "addresses",
    columns: [],
    jsonbColumns: [],
    kvMode: true,
    includeIdInValue: false,
    rowUpdatedAtCol: "updated_at",
  },
  // Live bug, 2026-09-27: reported "catalog edits on the website don't
  // reach the bot" — same class as addresses above. The bot registers all
  // 4 catalog entities as kv_mode (utils/business_repository.py's Phase-2
  // loop, 0030_phase2_remaining_entities.sql), but this file never learned
  // about them, so catalogStore.ts's assertSheetsAuthoritative() 409'd
  // every write the instant a tenant's catalog cutover flag went on, while
  // reads stayed on stale Sheets data regardless (isKnownPgEntity was
  // always false). catalog_fulfillments is bot-only order-fulfillment
  // HISTORY (never written by this repo), registered anyway for parity
  // with the bot's own schema list and cutoverEntities.ts/botHealth.ts,
  // which already both listed it as "required".
  catalog_categories: {
    table: "catalog_categories",
    columns: [],
    jsonbColumns: [],
    kvMode: true,
    includeIdInValue: false,
    rowUpdatedAtCol: "updated_at",
  },
  catalog_items: {
    table: "catalog_items",
    columns: [],
    jsonbColumns: [],
    kvMode: true,
    includeIdInValue: false,
    rowUpdatedAtCol: "updated_at",
  },
  catalog_item_options: {
    table: "catalog_item_options",
    columns: [],
    jsonbColumns: [],
    kvMode: true,
    includeIdInValue: false,
    rowUpdatedAtCol: "updated_at",
  },
  catalog_fulfillments: {
    table: "catalog_fulfillments",
    columns: [],
    jsonbColumns: [],
    kvMode: true,
    includeIdInValue: false,
    rowUpdatedAtCol: "updated_at",
  },
  // Live bug, 2026-10-25: "Bot users" page stayed frozen at the cutover day (new users and last_seen
  // never appeared) while only the COUNTS had been fixed (pgListUsersLight). `users` was deliberately
  // left unregistered, so listEntity/getEntity/putEntity("users") — used by the bot-users page and by
  // broadcasts — kept reading the frozen Sheets tab. Mirrors bot/migrations/sql/0002_users.sql and
  // business_repository.py's `users` EntitySchema. `is_premium` (0026) is intentionally NOT listed:
  // nothing on the site needs it, and omitting it keeps this working on a DB where 0026 hasn't run.
  users: {
    table: "users",
    columns: [
      "user_id", "username", "first_name", "last_name", "language",
      "profile_data", "orders", "is_admin", "is_banned", "ban_reason",
      "current_panel", "current_form", "form_data", "flood_timestamps",
      "joined_at", "last_seen", "referral_by", "notes",
    ],
    jsonbColumns: ["profile_data", "orders", "form_data", "flood_timestamps"],
    kvMode: false,
    includeIdInValue: false,
    rowUpdatedAtCol: "updated_at",
    nullableColumns: ["current_panel", "current_form", "referral_by"],
  },
};

export function listKnownPgEntities(): string[] {
  return Object.keys(ENTITY_SCHEMAS).sort();
}

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

/**
 * فقط‌خواندنیِ سبک از جدول `users` ی بات (کاربرانِ تلگرامِ بات، نه کاربران سایت): `id` (= user_id)
 * و در صورت وجود `last_seen`. عمداً در ENTITY_SCHEMAS ثبت نشده — ثبتش باعث می‌شد مسیرهای
 * نوشتنِ سایت (botUsers.ts) هم بی‌اطلاع از ستون‌های کاملِ جدول روی Postgres بنویسند. برای
 * شمارش و «فعال امروز» فقط همین دو ستون لازم است.
 * اگر ستون `last_seen` در جدول نبود (۴۲۷۰۳)، با فقط `id` تلاش مجدد می‌کند تا شمارشِ کل
 * حداقل درست بماند.
 * (۲۰۲۶-۱۰-۲۵: `users` حالا در ENTITY_SCHEMAS ثبت شده؛ این تابعِ سبک برای شمارش همچنان بهینه‌تر است.)
 */
export async function pgListUsersLight(tenantId: string): Promise<Array<{ key: string; last_seen: string | null }>> {
  try {
    return await withTenantTx(tenantId, async (client) => {
      const { rows } = await client.query<Record<string, unknown>>(
        "SELECT id, last_seen FROM users WHERE tenant_id = $1",
        [tenantId]
      );
      return rows.map((r: Record<string, unknown>) => ({
        key: String(r.id),
        last_seen: r.last_seen == null ? null : r.last_seen instanceof Date ? r.last_seen.toISOString() : String(r.last_seen),
      }));
    });
  } catch (err: any) {
    if (err?.code !== "42703") throw err; // undefined_column
    return withTenantTx(tenantId, async (client) => {
      const { rows } = await client.query<Record<string, unknown>>("SELECT id FROM users WHERE tenant_id = $1", [tenantId]);
      return rows.map((r: Record<string, unknown>) => ({ key: String(r.id), last_seen: null }));
    });
  }
}

/**
 * فهرستِ کاملِ فقط‌خواندنیِ جدول `users` ی بات برای صفحه‌ی «Bot users» (باتِ مهاجرت‌کرده کاربرِ تازه را
 * فقط در Postgres می‌نویسد؛ خواندن از تبِ شیت یعنی لیستِ فریزشده). عمداً در ENTITY_SCHEMAS ثبت
 * نشده — نوشتنِ سایت روی این جدول بدونِ DDLِ دقیقش ممکن است داده را خراب کند (PATCH همچنان ۴۰۹ می‌دهد).
 * `to_jsonb(u)` هر دو شکلِ جدول را بدونِ حدسِ ستون‌ها می‌خواند: kv-mode (ستونِ `value`) یا ستون‌های
 * تایپ‌شده با همان نامِ فیلدهای BotUser (`id` = user_id).
 */
export async function pgListUsersFull(tenantId: string): Promise<Array<{ key: string; value: Record<string, unknown> }>> {
  return withTenantTx(tenantId, async (client) => {
    const { rows } = await client.query<{ j: Record<string, unknown> }>(
      "SELECT to_jsonb(u) AS j FROM users u WHERE u.tenant_id = $1",
      [tenantId]
    );
    return rows.map(({ j }: { j: Record<string, unknown> }) => {
      const kv = j.value;
      const base: Record<string, unknown> =
        kv && typeof kv === "object" && !Array.isArray(kv)
          ? { ...(kv as Record<string, unknown>) }
          : (() => {
              const { tenant_id: _t, row_updated_at: _r, id: _i, ...rest } = j as Record<string, unknown>;
              return rest;
            })();
      const key = String(j.id ?? j.user_id ?? base.user_id ?? "");
      if (base.user_id == null) base.user_id = key;
      return { key, value: base };
    });
  });
}

export type PgUserSummary = {
  user_id: string; username: string; first_name: string; last_name: string; language: string;
  is_admin: boolean; is_banned: boolean; ban_reason: string; joined_at: string; last_seen: string;
  orderCount: number;
};

/**
 * لیستِ سبکِ صفحه‌یِ «Bot users» از جدول `users`: فقط ستون‌هایی که ردیفِ لیست لازم دارد.
 * `profile_data`/`form_data`/`flood_timestamps`/`orders` عمداً خوانده نمی‌شوند (در هزاران کاربر
 * سنگین‌ترین‌اند)؛ فقط طولِ `orders` برایِ شمارنده‌یِ سفارش.
 */
export async function pgListUsersSummary(tenantId: string): Promise<PgUserSummary[]> {
  return withTenantTx(tenantId, async (client) => {
    const { rows } = await client.query<Record<string, unknown>>(
      "SELECT id, user_id, username, first_name, last_name, language, is_admin, is_banned, ban_reason, " +
        "joined_at, last_seen, COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(orders) = 'array' THEN orders ELSE '[]'::jsonb END), 0) AS order_count " +
        "FROM users WHERE tenant_id = $1",
      [tenantId]
    );
    return rows.map((r: Record<string, unknown>) => ({
      user_id: String(r.user_id || r.id),
      username: String(r.username ?? ""),
      first_name: String(r.first_name ?? ""),
      last_name: String(r.last_name ?? ""),
      language: String(r.language ?? ""),
      is_admin: Boolean(r.is_admin),
      is_banned: Boolean(r.is_banned),
      ban_reason: String(r.ban_reason ?? ""),
      joined_at: String(r.joined_at ?? ""),
      last_seen: String(r.last_seen ?? ""),
      orderCount: Number(r.order_count ?? 0),
    }));
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
  const nullable = new Set(s.nullableColumns ?? []);
  const cols = s.columns.filter((c) => v[c] !== undefined && (v[c] !== null || nullable.has(c)));
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
