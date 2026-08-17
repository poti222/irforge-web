import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * بدون این، یک قطعیِ گذرای دیتابیس **کل سرور را می‌کشد**.
 *
 * `pg-pool` وقتی اتصال یک کلاینتِ *بیکار* بیفتد، رویداد `error` را روی خود Pool
 * منتشر می‌کند (pg-pool/index.js:62، `Client.idleListener`). این یک EventEmitter
 * است و رویداد `error` بی‌شنونده در Node یعنی throw و مرگ پروسه:
 *
 *     node:events:496  throw er; // Unhandled 'error' event
 *     Error: Connection terminated unexpectedly
 *
 * که در پروداکشن دیده شد و API را پایین آورد (Railway با restartPolicy
 * on_failure بالا می‌آورد، ولی سقف تلاشش سه بار است).
 *
 * این خطا قابل نادیده‌گرفتن است: کلاینتِ افتاده از استخر بیرون انداخته می‌شود و
 * درخواست بعدی یک اتصال تازه می‌گیرد. تنها کاری که لازم است، *شنیدنش* است.
 *
 * سه استخر دیگر این ریپو (botQueue، cutoverPool در botConfig، botCacheBust)
 * همین کار را از قبل می‌کردند — استخر اصلی جا افتاده بود.
 *
 * از `console.error` استفاده می‌شود و نه pino: این پکیج یک leaf lib است و
 * لاگر جزو وابستگی‌هایش نیست.
 */
pool.on("error", (err) => {
  console.error("[db] idle client error (ignored, client is discarded):", err.message);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
