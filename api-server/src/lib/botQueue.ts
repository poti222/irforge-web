/**
 * botQueue.ts — صف کار بات (`irforge_queue` روی Postgres بات).
 * ─────────────────────────────────────────────────────────────────────────────
 * `services/queue_worker.py` بات از این جدول job برمی‌دارد و به هندلر ثبت‌شده‌ی
 * همان `job_type` می‌دهد. سایت فقط **enqueue** می‌کند؛ هیچ‌وقت خودش کاری را
 * اجرا نمی‌کند و هیچ‌وقت job دیگری را نمی‌خواند/تغییر نمی‌دهد.
 *
 * اسکیمای جدول (`utils/postgres_store.py:124`):
 *   irforge_queue(id BIGSERIAL, job_type TEXT, payload JSONB,
 *                 status TEXT DEFAULT 'pending', attempts INT DEFAULT 0,
 *                 last_error TEXT, created_at DOUBLE PRECISION,
 *                 updated_at DOUBLE PRECISION)
 *
 * `created_at`/`updated_at` عمداً `DOUBLE PRECISION` هستند (اپوک ثانیه‌ای
 * پایتون، `time.time()`) نه timestamp — این را باید مو‌به‌مو رعایت کرد وگرنه
 * ردیف سایت با ردیف‌های بات هم‌شکل نیست.
 *
 * همان Postgresی است که `botCacheBust.ts` استفاده می‌کند، پس همان
 * `BOT_CACHE_DATABASE_URL`. نبودنش خطای واضح می‌دهد، نه سکوت.
 */
import pg from "pg";
import { logger } from "./logger.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function botQueueAvailable(): boolean {
  return Boolean(process.env.BOT_CACHE_DATABASE_URL);
}

function getPool(): pg.Pool {
  if (!botQueueAvailable())
    throw Object.assign(new Error("bot queue not configured"), { code: "queue_unavailable" });
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.BOT_CACHE_DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
    });
    pool.on("error", (err) => logger.warn({ err }, "botQueue: idle client error (ignored)"));
  }
  return pool;
}

export type QueueJob = {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

/** یک job جدید در وضعیت pending. خروجی، id همان ردیف است. */
export async function enqueueJob(jobType: string, payload: Record<string, unknown>): Promise<string> {
  const now = Date.now() / 1000; // ثانیه‌ی اعشاری، مثل `time.time()` پایتون
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO irforge_queue (job_type, payload, created_at, updated_at)
     VALUES ($1, $2::jsonb, $3, $3)
     RETURNING id`,
    [jobType, JSON.stringify(payload), now]
  );
  return String(rows[0].id);
}

/**
 * تاریخچه‌ی jobهای یک بات. چون جدول بین همه‌ی تننت‌ها مشترک است، فیلتر روی
 * `payload->>'spreadsheet_id'` انجام می‌شود — تنها چیزی که در payload یک بات را
 * از دیگری جدا می‌کند و **توکن نیست**.
 */
export async function listJobs(
  jobType: string,
  spreadsheetId: string,
  limit = 20
): Promise<QueueJob[]> {
  const { rows } = await getPool().query<QueueJob>(
    `SELECT id, job_type, payload, status, attempts, last_error, created_at, updated_at
     FROM irforge_queue
     WHERE job_type = $1 AND payload->>'spreadsheet_id' = $2
     ORDER BY id DESC
     LIMIT $3`,
    [jobType, spreadsheetId, Math.min(100, Math.max(1, limit))]
  );
  return rows.map((r) => ({ ...r, id: String(r.id) }));
}

export async function closeQueuePool(): Promise<void> {
  const p = pool;
  pool = null;
  if (p) await p.end().catch(() => undefined);
}
