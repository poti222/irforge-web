/**
 * lib/sheetsImport.ts — IRFORGE_POSTGRES_PRIMARY_SHEETS_BACKUP_PROMPT فاز ۲.
 *
 * آینه‌ی `mainbot/services/sheets_import.py` سمتِ سایت: خواندن/نوشتنِ صفِ
 * `sheets_import_requests` روی همان `BUSINESS_DATABASE_URL` که
 * `entity_cutover_flags` رویش است (`getCutoverPool()` از botConfig.ts —
 * یک pool مشترک، نه اتصالِ دومِ جدا).
 *
 * این ماژول خودِ ایمپورت را انجام نمی‌دهد — آن کارِ workerِ خودِ بات است
 * (`services/sheets_import.py::run_sheets_import_worker`، چون فقط بات به
 * Google Sheets و به هر ۸۳ repository‌یِ Postgres دسترسیِ یکنواخت دارد).
 * اینجا فقط صفِ کاری را enqueue/می‌خواند — دقیقاً همان تفکیکِ نقشی که
 * routes/cutoverFlags.ts برای خودِ پرچم‌ها دارد: سایت دکمه است، بات موتور.
 */
import { randomUUID } from "crypto";
import { getCutoverPool } from "./botConfig.js";
import { CUTOVER_ENTITIES } from "./cutoverEntities.js";
import { logger } from "./logger.js";

export type SheetsImportRequestRow = {
  id: string;
  tenantId: string;
  entities: string[] | null;
  status: string;
  requestedBy: string | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  entitiesDone: string[];
  entitiesSkipped: string[];
  entitiesFailed: { entity: string; error: string }[];
  updatedAt: string;
};

function toIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function mapRow(r: any): SheetsImportRequestRow {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    entities: r.entities ?? null,
    status: r.status,
    requestedBy: r.requested_by ?? null,
    requestedAt: toIso(r.requested_at)!,
    startedAt: toIso(r.started_at),
    finishedAt: toIso(r.finished_at),
    entitiesDone: r.entities_done ?? [],
    entitiesSkipped: r.entities_skipped ?? [],
    entitiesFailed: r.entities_failed ?? [],
    updatedAt: toIso(r.updated_at)!,
  };
}

/**
 * یک ردیفِ `pending` جدید برای یک تننت مشخص. `entities=null` یعنی «همه‌ی
 * entityهای شناخته‌شده» — همان قراردادِ `_target_entities(None)` سمتِ بات.
 * برخلافِ خواندن‌های fail-open این ماژول (پایین)، این تابع روی خطا throw
 * می‌کند: یک کلیکِ سوپرادمین که سکوت کند و او فکر کند صف شد، بدتر از خطای
 * صریح است — همان قاعده‌ی `setEntityUseDb`.
 */
export async function enqueueSheetsImport(
  tenantId: string,
  requestedBy: string,
  entities: string[] | null = null
): Promise<SheetsImportRequestRow> {
  const pool = getCutoverPool();
  if (!pool) {
    throw new Error("BUSINESS_DATABASE_URL روی این محیط تنظیم نشده — صفِ ایمپورت در دسترس نیست.");
  }
  const id = randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO sheets_import_requests (id, tenant_id, entities, status, requested_by, requested_at, updated_at)
     VALUES ($1, $2, $3, 'pending', $4, now(), now())
     RETURNING *`,
    [id, tenantId, entities, requestedBy]
  );
  return mapRow(rows[0]);
}

export type TenantImportStatus = {
  tenantId: string;
  postgresEntityCount: number;
  totalEntityCount: number;
  latestRequest: SheetsImportRequestRow | null;
};

/**
 * برای هر tenantId ورودی: تعدادِ entityهایی که الان override تک‌تننتیِ
 * `use_db = true` دارند (یعنی واقعاً روی Postgres زندگی می‌کنند برایِ همین
 * تننت)، به‌همراهِ آخرین درخواستِ ایمپورتش (اگر باشد). fail-open — اگر
 * pool در دسترس نباشد یا کوئری بخورد زمین، نقشه خالی برمی‌گردد (فراخوان
 * باید «نامشخص» نشان بدهد، نه اینکه بترکد).
 */
export async function listTenantImportStatuses(tenantIds: string[]): Promise<Map<string, TenantImportStatus>> {
  const result = new Map<string, TenantImportStatus>();
  if (tenantIds.length === 0) return result;

  const pool = getCutoverPool();
  if (!pool) return result;

  const totalEntityCount = CUTOVER_ENTITIES.length;

  try {
    const { rows: flagRows } = await pool.query<{ tenant_id: string; n: string }>(
      `SELECT tenant_id, count(*) AS n FROM entity_cutover_flags
       WHERE tenant_id = ANY($1) AND use_db = true GROUP BY tenant_id`,
      [tenantIds]
    );
    const countByTenant = new Map<string, number>(
      flagRows.map((r: { tenant_id: string; n: string }): [string, number] => [r.tenant_id, Number(r.n)])
    );

    const { rows: latestRows } = await pool.query(
      `SELECT DISTINCT ON (tenant_id) * FROM sheets_import_requests
       WHERE tenant_id = ANY($1) ORDER BY tenant_id, requested_at DESC`,
      [tenantIds]
    );
    const latestByTenant = new Map<string, SheetsImportRequestRow>(
      latestRows.map((r: any): [string, SheetsImportRequestRow] => [r.tenant_id as string, mapRow(r)])
    );

    for (const tenantId of tenantIds) {
      result.set(tenantId, {
        tenantId,
        postgresEntityCount: countByTenant.get(tenantId) ?? 0,
        totalEntityCount,
        latestRequest: latestByTenant.get(tenantId) ?? null,
      });
    }
  } catch (err) {
    logger.debug({ err }, "listTenantImportStatuses: read failed (fail-open)");
  }
  return result;
}

/** آخرین درخواست‌ها روی همه‌ی تننت‌ها — همان «یک تب که خرابی/تعدادِ
 * بات‌ها و دیتاها را ببینم» که سوپرادمین خواسته بود. */
export async function listRecentSheetsImportRequests(limit = 200): Promise<SheetsImportRequestRow[]> {
  const pool = getCutoverPool();
  if (!pool) return [];
  try {
    const { rows } = await pool.query("SELECT * FROM sheets_import_requests ORDER BY requested_at DESC LIMIT $1", [
      limit,
    ]);
    return rows.map(mapRow);
  } catch (err) {
    logger.debug({ err }, "listRecentSheetsImportRequests: read failed (fail-open)");
    return [];
  }
}
