/**
 * lib/sheetsExport.ts — the reverse of lib/sheetsImport.ts.
 *
 * Mirror of `mainbot/services/sheets_export.py` site-side: reads/writes the
 * `sheets_export_requests` queue on the same `BUSINESS_DATABASE_URL`
 * `entity_cutover_flags`/`sheets_import_requests` already live on
 * (`getCutoverPool()` from botConfig.ts — the same shared pool, not a
 * second connection).
 *
 * Does not do the actual Postgres→Sheets copy itself — that's the bot's
 * own job (`services/sheets_export.py::run_sheets_export_worker`, since
 * only the bot has uniform access to all 83 Postgres repositories and to
 * Google Sheets). This module only enqueues/reads the work queue — the
 * exact same role split as sheetsImport.ts has for the forward direction.
 */
import { getCutoverPool } from "./botConfig.js";
import { logger } from "./logger.js";
import type { SheetsImportRequestRow } from "./sheetsImport.js";
import { IN_FLIGHT_STATUSES, RETRY_MAX_TOTAL_SECONDS } from "./sheetsImport.js";
import { randomUUID } from "crypto";

export type SheetsExportRequestRow = SheetsImportRequestRow;

export { IN_FLIGHT_STATUSES, RETRY_MAX_TOTAL_SECONDS };

function toIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function mapRow(r: any): SheetsExportRequestRow {
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
    attemptCount: Number(r.attempt_count ?? 0),
    nextAttemptAt: toIso(r.next_attempt_at),
    updatedAt: toIso(r.updated_at)!,
  };
}

/**
 * A new `pending` row for one tenant. `entities=null` means "every
 * currently-cutover entity" — same convention as `enqueueSheetsImport`.
 * Throws on failure rather than fail-open, same reasoning as the import
 * side: a click that silently doesn't queue anything is worse than a
 * visible error.
 */
export async function enqueueSheetsExport(
  tenantId: string,
  requestedBy: string,
  entities: string[] | null = null
): Promise<SheetsExportRequestRow> {
  const pool = getCutoverPool();
  if (!pool) {
    throw new Error("BUSINESS_DATABASE_URL روی این محیط تنظیم نشده — صفِ بازگشت به Sheet در دسترس نیست.");
  }
  const id = randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO sheets_export_requests (id, tenant_id, entities, status, requested_by, requested_at, updated_at)
     VALUES ($1, $2, $3, 'pending', $4, now(), now())
     RETURNING *`,
    [id, tenantId, entities, requestedBy]
  );
  return mapRow(rows[0]);
}

/** The latest export request for one tenant, if any — fail-open (null on
 * any read error), same reasoning as listTenantImportStatuses. */
export async function latestSheetsExportRequest(tenantId: string): Promise<SheetsExportRequestRow | null> {
  const pool = getCutoverPool();
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      "SELECT * FROM sheets_export_requests WHERE tenant_id = $1 ORDER BY requested_at DESC LIMIT 1",
      [tenantId]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  } catch (err) {
    logger.debug({ err }, "latestSheetsExportRequest: read failed (fail-open)");
    return null;
  }
}

