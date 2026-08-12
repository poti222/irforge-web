/**
 * botCacheBust.ts — باطل‌کردن کش بات بعد از هر نوشتنِ سایت روی شیت تننت.
 * ─────────────────────────────────────────────────────────────────────────────
 * مسئله (ممیزی فاز ۰، بخش ج): `SheetsManager` بات سه لایه کش دارد —
 *   L1: دیکشنری درون‌پروسسی با `CACHE_TTL = 60` ثانیه.
 *   L2: جدول `irforge_cache` روی Postgres بات، مشترک بین replicaها.
 *   L3: خود Google Sheets (منبع حقیقت).
 *
 * اگر سایت مستقیم روی Sheets بنویسد، بات تا انقضای L1/L2 تغییر را نمی‌بیند.
 * پاک‌کردن ردیف L2 باعث می‌شود replicaهایی که L1شان هم منقضی شده، بلافاصله از
 * خود Sheets بخوانند — یعنی تأخیر از «تا ۶۰ ثانیه» به «تا انقضای L1 همان
 * پروسس» کاهش پیدا می‌کند. L1 از بیرون قابل دسترسی نیست، پس این سقفِ کاری است.
 *
 * اسکیما و کلید (تأییدشده روی سورس بات):
 *   `irforge_cache(cache_key TEXT PRIMARY KEY, value JSONB, expires_at DOUBLE PRECISION)`
 *     — `utils/postgres_store.py:108`
 *   کلید = `` `${spreadsheet_id}:${sheet_name}` `` — `utils/sheets_manager.py:126`
 *
 * ⚠️ این Postgres، Postgresِ **بات** است (بات با `DATABASE_URL`/`POSTGRES_URL`
 *    خودش بازش می‌کند) و لزوماً همان Postgres سایت نیست. برای همین متغیر جدا
 *    `BOT_CACHE_DATABASE_URL` است و عمداً به `DATABASE_URL` سایت fallback
 *    نمی‌کند — نوشتن روی دیتابیس اشتباه بدتر از نوشتن نکردن است.
 *
 * قانون: **همه‌ی خطاها بلعیده و فقط لاگ می‌شوند.** شکست cache-bust هرگز نباید
 * یک نوشتنِ موفق روی شیت را به خطا تبدیل کند.
 */
import pg from "pg";
import { logger } from "./logger.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let poolFailed = false;

/** آیا cache-bust روی این محیط پیکربندی شده؟ UI از این برای متن بنر استفاده می‌کند. */
export function cacheBustEnabled(): boolean {
  return Boolean(process.env.BOT_CACHE_DATABASE_URL);
}

function getPool(): pg.Pool | null {
  if (!cacheBustEnabled() || poolFailed) return null;
  if (pool) return pool;
  try {
    pool = new Pool({
      connectionString: process.env.BOT_CACHE_DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
    });
    // یک Pool بدون listener روی 'error' با قطع‌شدن اتصالِ بی‌کار، پروسس را
    // می‌کشد. اینجا فقط لاگ می‌کنیم.
    pool.on("error", (err) => {
      logger.warn({ err }, "botCacheBust: idle client error (ignored)");
    });
    return pool;
  } catch (err) {
    poolFailed = true;
    logger.warn({ err }, "botCacheBust: could not create pool (ignored)");
    return null;
  }
}

export function cacheKey(spreadsheetId: string, tab: string): string {
  return `${spreadsheetId}:${tab}`;
}

/**
 * ردیف کش یک تب را پاک می‌کند. idempotent، و وقتی جدول اصلاً وجود ندارد
 * (یا دیتابیس در دسترس نیست) بی‌سروصدا رد می‌شود.
 */
export async function bustTabCache(spreadsheetId: string, tab: string): Promise<boolean> {
  const p = getPool();
  if (!p) return false;
  try {
    await p.query("DELETE FROM irforge_cache WHERE cache_key = $1", [cacheKey(spreadsheetId, tab)]);
    return true;
  } catch (err) {
    logger.warn({ err, spreadsheetId, tab }, "botCacheBust: delete failed (ignored)");
    return false;
  }
}

/** همان بالا برای چند تب — با یک کوئری. */
export async function bustTabsCache(spreadsheetId: string, tabs: string[]): Promise<boolean> {
  const unique = [...new Set(tabs.filter(Boolean))];
  if (unique.length === 0) return false;
  const p = getPool();
  if (!p) return false;
  try {
    await p.query("DELETE FROM irforge_cache WHERE cache_key = ANY($1::text[])", [
      unique.map((t) => cacheKey(spreadsheetId, t)),
    ]);
    return true;
  } catch (err) {
    logger.warn({ err, spreadsheetId, tabs: unique }, "botCacheBust: bulk delete failed (ignored)");
    return false;
  }
}

/** بستن Pool — فقط برای تست/خاموشی تمیز. */
export async function closeCacheBustPool(): Promise<void> {
  const p = pool;
  pool = null;
  if (!p) return;
  try {
    await p.end();
  } catch {
    /* ignored */
  }
}
