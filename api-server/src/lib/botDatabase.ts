/**
 * lib/botDatabase.ts — IRFORGE_PAID_SQL_DATABASE_PROMPT.
 *
 * The self-service, paid counterpart to the superadmin-only Sheets Import
 * tool (routes/sheetsImport.ts): a bot owner pays a fixed one-time fee from
 * their own wallet to move ONE bot's entire data from Google Sheets to
 * Postgres ("SQL"), and can move it back later. Reuses the exact same
 * migration engine `enqueueSheetsImport` already drives (unmodified — it
 * already supports "every entity, one tenant, one call" via
 * `entities=null`); the reverse direction goes through the new sibling
 * `enqueueSheetsExport` (lib/sheetsExport.ts) and the bot's new
 * `services/sheets_export.py` worker.
 *
 * 2026-09-23 — changed from a recurring monthly charge to a one-time,
 * unlimited-duration purchase per explicit operator decision: 249,000
 * Toman once, never billed again. "Unlimited" is represented by setting
 * `databaseSqlExpiresAt` to `SQL_DATABASE_UNLIMITED_EXPIRY` (a sentinel far
 * in the future) rather than a schema change — this column is already
 * exactly the right shape (nullable timestamp, `null` = never purchased),
 * and every "is this still active" check elsewhere in this codebase
 * (e.g. `planLimits.ts`'s `isActive()`) already treats "any date still in
 * the future" as active, so a sentinel this far out satisfies that without
 * any consumer needing to know about a special unlimited case.
 *
 * Deliberate design choice: `bots.databaseSqlExpiresAt` (schema/bots.ts) is
 * the source of truth for BILLING only — whether this bot has paid.
 * It is NOT a cached "is this bot on SQL" flag. WHERE THE DATA ACTUALLY
 * LIVES is always computed live from `entity_cutover_flags` (via
 * `getBotDatabaseStatus` below), the same way `listTenantImportStatuses`
 * already does for the superadmin panel. Since the same purchase now
 * covers every entity with no further payment, `mode` reports "sql" the
 * moment billing says paid — even if only a couple of the ~90 entities
 * have actually finished copying so far in the background — rather than
 * waiting for 100% completion; `postgresEntityCount`/`totalEntityCount`
 * are still returned so the frontend can show real progress separately.
 * A migration/reversion still genuinely in flight is tracked via
 * `importInFlight`/`exportInFlight` below, independent of `mode` — route
 * guards must check those directly (not `mode`) so a reversal can never be
 * started while the initial migration is still copying data.
 */
import {
  enqueueSheetsImport,
  listTenantImportStatuses,
  IN_FLIGHT_STATUSES as IMPORT_IN_FLIGHT,
  type SheetsImportRequestRow,
} from "./sheetsImport.js";
import { enqueueSheetsExport, latestSheetsExportRequest, type SheetsExportRequestRow } from "./sheetsExport.js";
import type { Toman } from "./currency.js";

/** Flat, fixed one-time price — not a `products` table row (unlike bot
 * tiers/the storefront bundle) since the user specified one exact number
 * with no per-instance variation, matching PLUGIN_PRICES's own precedent
 * of a hardcoded price table for things that don't need admin-editable
 * pricing. Kept here (not pluginPricing.ts) since this domain has its own
 * dedicated file already. */
export const SQL_DATABASE_PRICE_TOMAN: Toman = 249_000;

/** Sentinel `databaseSqlExpiresAt` value meaning "purchased, never
 * expires" — see the file docstring above for why this isn't a schema
 * change. Exported so route handlers and the expiry sweep can both write/
 * recognize the exact same value. */
export const SQL_DATABASE_UNLIMITED_EXPIRY: Date = new Date("9999-12-31T00:00:00.000Z");

export type BotDatabaseMode = "sheets" | "migrating" | "reverting" | "sql";

export type BotDatabaseStatus = {
  mode: BotDatabaseMode;
  postgresEntityCount: number;
  totalEntityCount: number;
  sqlExpiresAt: string | null;
  /** true once this bot has paid (and isn't currently reverting) — lets the
   * frontend say "no further payment, ever" instead of computing a bogus
   * multi-century "renews in N days" from the sentinel expiry date. */
  unlimited: boolean;
  /** A Sheets→SQL migration is still copying data right now — independent
   * of `mode`, since `mode` already reports "sql" as soon as billing says
   * paid, before every entity has necessarily finished. */
  importInFlight: boolean;
  /** A SQL→Sheets reversal is still running right now. */
  exportInFlight: boolean;
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
 *
 * `purchased` is checked before `importInFlight`/the entity-count fallback:
 * a paying tenant is "sql" from the moment they pay, not from the moment
 * every entity finishes copying. The entity-count fallback stays below it
 * for a tenant migrated by the superadmin Sheets Import tool instead of
 * this paid flow (`purchased` false there — that tool never sets
 * `databaseSqlExpiresAt`) — unchanged from before this file's 2026-09-23
 * pricing change, so an already-migrated canary tenant's own status page
 * keeps reporting "sql" exactly as it did previously.
 */
export function computeBotDatabaseMode(
  postgresEntityCount: number,
  totalEntityCount: number,
  importInFlight: boolean,
  exportInFlight: boolean,
  purchased: boolean
): BotDatabaseMode {
  if (exportInFlight) return "reverting";
  if (purchased) return "sql";
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
  // "خریداری‌شده" یعنی هنوز منقضی نشده (سنتینل ۹۹۹۹ همیشه همین جواب را
  // می‌دهد) — نه فقط غیرنال بودن، تا یک تاریخِ گذشته‌ی باقی‌مانده از قبلِ
  // این تغییر (اگر جایی باشد) اشتباهاً «فعال» گزارش نشود.
  const purchased = Boolean(sqlExpiresAt && sqlExpiresAt.getTime() > Date.now());

  const mode = computeBotDatabaseMode(postgresEntityCount, totalEntityCount, importInFlight, exportInFlight, purchased);

  return {
    mode,
    postgresEntityCount,
    totalEntityCount,
    sqlExpiresAt: sqlExpiresAt ? sqlExpiresAt.toISOString() : null,
    unlimited: purchased,
    importInFlight,
    exportInFlight,
    latestImportRequest,
    latestExportRequest,
    priceToman: SQL_DATABASE_PRICE_TOMAN,
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
