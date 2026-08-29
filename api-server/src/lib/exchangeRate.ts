/**
 * lib/exchangeRate.ts — Phase 10 of identityverificationspec.md.
 * ─────────────────────────────────────────────────────────────────────────────
 * The real, billing-authoritative USD→Rial rate used to convert a
 * live-priced plan's `priceUsd` into the Toman amount actually charged —
 * see the header comment on `exchangeRatesTable` (schema/exchangeRates.ts)
 * for why this is a separate concept from Phase 39's display-only
 * `currency_display` setting.
 *
 * Source: Nobitex's public, keyless market-stats endpoint
 * (api.nobitex.ir/market/stats), reading the USDT/Rial price as a USD
 * proxy — official USD isn't a tradeable market in Iran, and USDT-as-USD
 * is already this codebase's own precedent (see `tomanPerUsdt` in
 * platformSettings.ts, used for the same reason on the wallet deposit
 * page). No API key needed, and no new external dependency: uses the
 * platform's native `fetch`.
 *
 * There is no cron/scheduler anywhere in this codebase (see the header
 * comment on `cleanupExpired()` in migrate.mjs) — this module doesn't add
 * one either. `index.ts` calls `refreshExchangeRateFromApi()` once at boot
 * and again every hour via `setInterval`, which is sufficient for a
 * long-lived Railway process; it is never called from inside a request
 * handler.
 */
import { desc } from "drizzle-orm";
import { db, exchangeRatesTable } from "@workspace/db";
import crypto from "crypto";
import { logger } from "./logger";

const NOBITEX_STATS_URL = "https://api.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls";
/** Past this age, the rate is shown to admins as stale rather than silently trusted. */
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

export type CurrentExchangeRate = {
  rialPerUsd: number;
  source: "api" | "manual";
  fetchedAt: Date;
  stale: boolean;
};

/** Pure so it's testable without a clock mock touching the DB layer. */
export function isRateStale(fetchedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - fetchedAt.getTime() > STALE_AFTER_MS;
}

/**
 * `Math.ceil((usdPrice * rialPerUsd / 10) / 10000) * 10000` — decision
 * locked in with Ali in identityverificationspec.md. `/10` converts Rial to
 * Toman; rounding up to the nearest 10,000 Toman keeps prices looking like
 * every other hand-set price in this product instead of a jagged
 * live-converted number.
 */
export function priceInToman(usdPrice: number, rialPerUsd: number): number {
  return Math.ceil((usdPrice * rialPerUsd / 10) / 10000) * 10000;
}

/**
 * Never throws: on any failure (DB down, empty table) the caller falls
 * back to treating live-priced plans as unavailable rather than crashing a
 * page that also shows flat-Toman plans. Matches `getPaymentMethods()`'s
 * convention in platformSettings.ts.
 */
export async function getCurrentExchangeRate(): Promise<CurrentExchangeRate | null> {
  try {
    const [row] = await db
      .select()
      .from(exchangeRatesTable)
      .orderBy(desc(exchangeRatesTable.fetchedAt))
      .limit(1);
    if (!row) return null;
    return {
      rialPerUsd: row.rialPerUsd,
      source: row.source as "api" | "manual",
      fetchedAt: row.fetchedAt,
      stale: isRateStale(row.fetchedAt),
    };
  } catch (err) {
    logger.warn({ err }, "getCurrentExchangeRate failed");
    return null;
  }
}

/**
 * Admin manual override — always wins over the next automatic sync's
 * result until that sync completes, simply because it's the newest row.
 */
export async function setManualExchangeRate(rialPerUsd: number, updatedBy: string): Promise<CurrentExchangeRate> {
  const [row] = await db.insert(exchangeRatesTable).values({
    id: crypto.randomUUID(),
    rialPerUsd,
    source: "manual",
    updatedBy,
  }).returning();
  return { rialPerUsd: row.rialPerUsd, source: "manual", fetchedAt: row.fetchedAt, stale: false };
}

/**
 * Best-effort automatic refresh. Swallows every failure (network, bad
 * shape, non-2xx) and just logs — a failed sync means the previous row
 * keeps serving and eventually shows as stale to admins, which is the
 * intended degradation, not a server error.
 */
export async function refreshExchangeRateFromApi(): Promise<void> {
  try {
    const res = await fetch(NOBITEX_STATS_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Nobitex stats returned ${res.status}`);
    const body: any = await res.json();
    const latest = Number(body?.stats?.["usdt-rls"]?.latest);
    if (!Number.isFinite(latest) || latest <= 0) {
      throw new Error(`Unexpected Nobitex response shape: ${JSON.stringify(body).slice(0, 200)}`);
    }
    await db.insert(exchangeRatesTable).values({
      id: crypto.randomUUID(),
      rialPerUsd: latest,
      source: "api",
      updatedBy: null,
    });
    logger.info({ rialPerUsd: latest }, "exchange rate synced from Nobitex");
  } catch (err) {
    logger.warn({ err }, "refreshExchangeRateFromApi failed — keeping last known rate");
  }
}
