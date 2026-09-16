/**
 * lib/botDatabase.ts — IRFORGE_PAID_SQL_DATABASE_PROMPT.
 *
 * The self-service, paid counterpart to the superadmin-only Sheets Import
 * tool (routes/sheetsImport.ts): a bot owner pays a fixed monthly fee from
 * their own wallet to move ONE bot's entire data from Google Sheets to
 * Postgres ("SQL"), and can move it back later. Reuses the exact same
 * migration engine `enqueueSheetsImport` already drives (unmodified — it
 * already supports "every entity, one tenant, one call" via
 * `entities=null`); the reverse direction goes through the new sibling
 * `enqueueSheetsExport` (lib/sheetsExport.ts) and the bot's new
 * `services/sheets_export.py` worker.
 *
 * Deliberate design choice: `bots.databaseSqlExpiresAt` (schema/bots.ts) is
 * the source of truth for BILLING only — whether this bot currently has a
 * paid subscription and when it next renews. It is NOT a cached "is this
 * bot on SQL" flag. WHERE THE DATA ACTUALLY LIVES is always computed live
 * from `entity_cutover_flags` (via `getBotDatabaseStatus` below), the same
 * way `listTenantImportStatuses` already does for the superadmin panel —
 * so a stuck/slow migration can never leave the two states silently out of
 * sync with each other; the "migrating"/"reverting" states below exist
 * precisely to surface that gap instead of hiding it.
 */
import {
  enqueueSheetsImport,
  listTenantImportStatuses,
  IN_FLIGHT_STATUSES as IMPORT_IN_FLIGHT,
  type SheetsImportRequestRow,
} from "./sheetsImport.js";
import { enqueueSheetsExport, latestSheetsExportRequest, type SheetsExportRequestRow } from "./sheetsExport.js";
import type { Toman } from "./currency.js";

/** Flat, fixed monthly price — not a `products` table row (unlike bot
 * tiers/the storefront bundle) since the user specified one exact number
 * with no per-instance variation, matching PLUGIN_PRICES's own precedent
 * of a hardcoded price table for things that don't need admin-editable
 * pricing. Kept here (not pluginPricing.ts) since this domain has its own
 * dedicated file already. */
export const SQL_DATABASE_MONTHLY_PRICE_TOMAN: Toman = 140_000;

export type BotDatabaseMode = "sheets" | "migrating" | "reverting" | "sql";

export type BotDatabaseStatus = {
  mode: BotDatabaseMode;
  postgresEntityCount: number;
  totalEntityCount: number;
  sqlExpiresAt: string | null;
  latestImportRequest: SheetsImportRequestRow | null;
  latestExportRequest: SheetsExportRequestRow | null;
  priceToman: Toman;
};

/**
 * Pure mode decision, pulled out of getBotDatabaseStatus so the one bug this
 * already caught once — `postgresEntityCount >= totalEntityCount` reading
 * `0 >= 0` as "fully migrated" whenever the cutover pool is unreachable and
 * both fail open to zero — can be locked down with a plain unit test instead
 * of having to fake a live-vs-down Postgres pool.
 */
export function computeBotDatabaseMode(
  postgresEntityCount: number,
  totalEntityCount: number,
  importInFlight: boolean,
  exportInFlight: boolean
): BotDatabaseMode {
  if (exportInFlight) return "reverting";
  if (importInFlight) return "migrating";
  // totalEntityCount === 0 means the cutover status couldn't be read (fail-
  // open in listTenantImportStatuses — no pool, or the query failed), not
  // "zero entities to migrate" (CUTOVER_ENTITIES is never empty). Without
  // this guard, 0 >= 0 would misreport an unmigrated/unknown bot as already
  // on SQL the moment BUSINESS_DATABASE_URL is briefly unreachable.
  if (totalEntityCount > 0 && postgresEntityCount >= totalEntityCount) return "sql";
  return "sheets";
}

/**
 * Live status for one bot's database, computed fresh every call (this is a
 * status-read endpoint, not a hot path — no caching needed, and caching it
 * would reintroduce exactly the stale-state risk the whole design avoids).
 * `tenantId` is the bot's `sheetId` (every cutover/import/export table is
 * keyed by tenant_id = spreadsheet id, matching the rest of the cutover
 * system).
 */
export async function getBotDatabaseStatus(
  tenantId: string,
  sqlExpiresAt: Date | null
): Promise<BotDatabaseStatus> {
  const [importStatuses, latestExportRequest] = await Promise.all([
    listTenantImportStatuses([tenantId]),
    latestSheetsExportRequest(tenantId),
  ]);
  const importStatus = importStatuses.get(tenantId);
  const postgresEntityCount = importStatus?.postgresEntityCount ?? 0;
  const totalEntityCount = importStatus?.totalEntityCount ?? 0;
  const latestImportRequest = importStatus?.latestRequest ?? null;

  const importInFlight = Boolean(latestImportRequest && IMPORT_IN_FLIGHT.has(latestImportRequest.status));
  const exportInFlight = Boolean(latestExportRequest && IMPORT_IN_FLIGHT.has(latestExportRequest.status));

  const mode = computeBotDatabaseMode(postgresEntityCount, totalEntityCount, importInFlight, exportInFlight);

  return {
    mode,
    postgresEntityCount,
    totalEntityCount,
    sqlExpiresAt: sqlExpiresAt ? sqlExpiresAt.toISOString() : null,
    latestImportRequest,
    latestExportRequest,
    priceToman: SQL_DATABASE_MONTHLY_PRICE_TOMAN,
  };
}

/** Kicks off the Sheets→SQL migration for one bot — every entity, one
 * call, exactly what the existing engine already supports. Does not touch
 * billing; the caller (routes/bots.ts) charges the wallet and sets
 * `databaseSqlExpiresAt` first. */
export async function startSqlMigration(tenantId: string, requestedBy: string) {
  return enqueueSheetsImport(tenantId, requestedBy, null);
}

/** Kicks off the SQL→Sheets reversal for one bot — every currently-
 * cutover entity, one call. Does not touch billing. */
export async function startSheetsReversion(tenantId: string, requestedBy: string) {
  return enqueueSheetsExport(tenantId, requestedBy, null);
}
