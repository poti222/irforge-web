/**
 * businessDbPool.ts — the one connection pool to `BUSINESS_DATABASE_URL`
 * (the Postgres database `bot/utils/db_business.py` also connects to for
 * PHASE 17 business data). Split out of `botConfig.ts` so `businessPg.ts`
 * (the entity repository) and `botConfig.ts` (cutover-flag reads) can both
 * depend on it without importing each other.
 */
import pg from "pg";
import { logger } from "./logger.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let poolFailed = false;

/**
 * `max: 10` mirrors `bot/utils/db_business.py`'s own
 * `ThreadedConnectionPool(1, 10, ...)` — this pool now serves real entity
 * read/write traffic for any Postgres-cut-over tenant (`businessPg.ts`),
 * not just the occasional cutover-flag check it was sized for originally.
 */
export function getBusinessPool(): pg.Pool | null {
  if (!process.env.BUSINESS_DATABASE_URL || poolFailed) return null;
  if (pool) return pool;
  try {
    pool = new Pool({
      connectionString: process.env.BUSINESS_DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
    });
    pool.on("error", (err: Error) => {
      // یک کانکشنِ idle که سمتِ سرور قطع شده — pg خودش آن را دور می‌ریزد؛ فقط
      // لاگ می‌کنیم که کرش نکند (همان الگوی pg's own recommended handler).
      logger.error({ err }, "businessDbPool: idle client error");
    });
  } catch (err: unknown) {
    logger.warn({ err }, "businessDbPool: could not create pool (fail-open)");
    poolFailed = true;
    return null;
  }
  return pool;
}
