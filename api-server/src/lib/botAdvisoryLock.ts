/**
 * lib/botAdvisoryLock.ts — IRFORGE_PROMPT_V3 Phase 24
 * ─────────────────────────────────────────────────────────────────────────────
 * Cross-process `pg_advisory_lock` against the bot's own Postgres
 * (`BOT_CACHE_DATABASE_URL`), for website mutations that must serialize with
 * the bot's own read-modify-write on the same row.
 *
 * Google Sheets has no atomic conditional write. The bot avoids a
 * lost-update race on wallet balances by wrapping every balance mutation in
 * a `pg_advisory_lock` keyed by wallet id
 * (`plugins/wallet/service.py::_wallet_lock`, Phase 18.0.4) — a session-level
 * `pg_advisory_lock(key)` / `pg_advisory_unlock(key)` pair on the bot's own
 * Postgres (`utils/postgres_store.py::lock()`), where
 * `key = crc32(name) & 0x7FFFFFFF` (`_advisory_key`).
 *
 * `lib/walletStore.ts` needs the exact same lock, on the exact same
 * database, with the exact same key derivation — otherwise a website credit
 * racing a bot-side debit on the same wallet would silently lose an update
 * (read balance → add → write back, unserialized). `BOT_CACHE_DATABASE_URL`
 * already points at that same Postgres instance (see `botCacheBust.ts`'s own
 * header comment — the bot's `DATABASE_URL`/`POSTGRES_URL`, which is where
 * its `locks` namespace lives, is exposed to the website under this name and
 * deliberately never falls back to the site's own `DATABASE_URL`).
 *
 * CRC-32 is reimplemented by hand instead of using Node's `zlib.crc32()`
 * (only added in Node 22, and this repo has no pinned Node version to rely
 * on) — verified bit-for-bit against Python's `zlib.crc32` for this exact
 * use before writing this file.
 *
 * Unlike `botCacheBust.ts` (which swallows every failure — cache-busting is
 * a nice-to-have, "a failed bust must never turn a successful sheet write
 * into an error"), a caller here is about to move real money: if the lock
 * database isn't configured or is unreachable, `withLock` THROWS. Callers
 * must never fall back to an unlocked read-modify-write on a wallet.
 */
import pg from "pg";
import { logger } from "./logger.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

function crc32(input: string): number {
  let crc = 0xFFFFFFFF;
  const buf = Buffer.from(input, "utf8");
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function advisoryKeyFor(name: string): number {
  return crc32(name) & 0x7FFFFFFF;
}

/** Exposed only so a test can pin this against `utils/postgres_store.py::_advisory_key` — never used by app code directly. */
export const __testables = { crc32, advisoryKeyFor };

function getPool(): pg.Pool {
  if (!process.env.BOT_CACHE_DATABASE_URL) {
    throw new Error(
      "BOT_CACHE_DATABASE_URL is not configured on this environment — wallet-mutating " +
        "actions refuse to run without the same distributed lock the bot itself uses, " +
        "to avoid a lost-update race on the balance."
    );
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.BOT_CACHE_DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
    });
    pool.on("error", (err) => {
      logger.warn({ err }, "botAdvisoryLock: idle client error (ignored)");
    });
  }
  return pool;
}

export const advisoryLock = {
  isConfigured(): boolean {
    return Boolean(process.env.BOT_CACHE_DATABASE_URL);
  },

  /**
   * Runs `fn` while holding the same session-level `pg_advisory_lock` the
   * bot would take for this exact `name` (e.g. `wallet:apply:${walletId}`,
   * matching `plugins/wallet/service.py::_wallet_lock`'s naming exactly).
   */
  async withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const p = getPool();
    const key = advisoryKeyFor(name);
    const client = await p.connect();
    try {
      await client.query("SELECT pg_advisory_lock($1)", [key]);
      try {
        return await fn();
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [key]);
      }
    } finally {
      client.release();
    }
  },
};
