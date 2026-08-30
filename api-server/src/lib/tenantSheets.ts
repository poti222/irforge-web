/**
 * tenantSheets.ts — the SHARED tenant-sheet access layer (parity group G0).
 *
 * The Telegram bot stores ALL business data as a key/value tab: row 1 is the
 * header `["key","value"]`, and every other row is `[key, JSON.stringify(value)]`
 * (see bot `utils/sheets_manager.py`). This module gives the web API awaitable
 * read/write access to ANY spreadsheet in that exact format — so the site edits
 * the *same* spreadsheet the bot reads, instead of a parallel copy.
 *
 * Unlike `sheetsSync.ts` (fire-and-forget mirror to a separate DATA sheet), these
 * functions await and surface real errors — the Database menu needs to know if a
 * write actually succeeded.
 */
import {
  readSheet,
  readSheetRanges,
  writeSheet,
  appendSheet,
  clearSheet,
  listTabs,
  addTab,
  quoteTab,
  ensureAllTenantTabs,
  isMissingTabError,
} from "./sheets.js";

export { listTabs, addTab, ensureAllTenantTabs };

export type TenantRow = {
  key: string;
  /** Parsed JSON value, or the raw string when the cell is not valid JSON. */
  value: unknown;
  /** True when the cell held plain (non-JSON) text — the bot tolerates this. */
  raw: boolean;
};

/**
 * ترمیمِ سلول‌هایی که نوشتنِ قبلی خرابشان کرده.
 *
 * تا پیش از این، سایت با `USER_ENTERED` می‌نوشت و گوگل `false` را به یک سلول
 * بولی واقعی تبدیل می‌کرد؛ همان سلول موقع خواندن `FALSE` برمی‌گردد که JSON
 * معتبر نیست. نوشتن حالا `RAW` است و دیگر چنین سلولی ساخته نمی‌شود، ولی
 * شیت‌هایی که از قبل خراب شده‌اند همچنان همین را برمی‌گردانند — و تا وقتی
 * کسی آن کلید را دوباره ذخیره نکند، خراب می‌مانند.
 *
 * پس فقط همین دو مقدار (که در JSON معتبر هرگز به این شکل ظاهر نمی‌شوند)
 * به بولی ترجمه می‌شوند. عمداً محدود است: `1` یا `yes` یا رشته‌ی خالی دست
 * نمی‌خورند، چون آن‌ها می‌توانند داده‌ی واقعی کاربر باشند.
 */
function healSheetsBoolean(cell: string): boolean | null {
  if (cell === "TRUE") return true;
  if (cell === "FALSE") return false;
  return null;
}

/** Parse a value cell the way the bot does: JSON first, raw string on failure. */
function parseCell(cell: string | undefined): { value: unknown; raw: boolean } {
  if (cell == null || cell === "") return { value: "", raw: true };
  try {
    return { value: JSON.parse(cell), raw: false };
  } catch {
    const healed = healSheetsBoolean(cell);
    if (healed !== null) return { value: healed, raw: false };
    return { value: cell, raw: true };
  }
}

/** Serialize a value the way the bot does (ensure_ascii=False ≈ default JSON.stringify). */
export function serializeValue(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Read every key/value row of a tab as decoded objects (header skipped).
 *
 * **یک تبِ ناموجود = یک تبِ خالی.** این تنها فرقِ رفتاری با قبل است و ریشه‌ی
 * مشترک چند باگ گزارش‌شده بود: فرم‌ها، آبجکت‌ها، ریلیشن‌ها و کامندهای سفارشی
 * همگی با «خطای نامشخص سرور» بالا نمی‌آمدند، چون شیتِ آن تننت هنوز تبِ
 * مربوطه را نداشت و Sheets API روی range ناموجود ۴۰۰ می‌دهد.
 *
 * چرا «خالی» و نه «تب را همین‌جا بساز»؟ چون خواندن نباید بنویسد: یک GET
 * ساده نباید ساختار شیتِ کاربر را عوض کند، و مسیر نوشتن (`upsertRow` →
 * `ensureHeader`) از قبل تب را موقع اولین ذخیره می‌سازد. پس سکشن خالی بالا
 * می‌آید، کاربر اولین رکوردش را می‌سازد، و تب همان‌جا ساخته می‌شود.
 *
 * `ensureAllTenantTabs` هم هنوز سر جایش است و تب‌ها را موقع تخصیص شیت
 * می‌سازد؛ این‌یکی توری‌ست برای شیت‌هایی که قبل از آن ساخته شده‌اند و برای
 * تب‌های پویا مثل `obj_<slug>` که در آن لیست نیستند.
 */
/** خام‌ترین سطرهای `values.get`/`values.batchGet` → همان شکلِ `readTabRows`. */
function rowsFromValues(rows: string[][]): TenantRow[] {
  const out: TenantRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const key = rows[i]?.[0];
    if (!key) continue;
    const { value, raw } = parseCell(rows[i]?.[1]);
    out.push({ key, value, raw });
  }
  return out;
}

export async function readTabRows(
  spreadsheetId: string,
  tab: string
): Promise<TenantRow[]> {
  let rows: string[][];
  try {
    rows = await readSheet(spreadsheetId, `${quoteTab(tab)}!A:B`);
  } catch (err) {
    if (isMissingTabError(err)) return [];
    throw err;
  }
  return rowsFromValues(rows);
}

/**
 * چند تبِ یک شیتِ تننت را با **یک** فراخوانی API می‌خواند (`readSheetRanges`) —
 * ببینید کامنتِ آن تابع در `sheets.ts` برای اینکه چرا این مهم است (سهمیه‌ی
 * خواندنِ Sheets API بینِ همه‌ی بات‌های سایت مشترک است). اگر حتی یکی از
 * تب‌ها هنوز ساخته نشده باشد، خودِ batchGet کل درخواست را رد می‌کند — این‌جا
 * آن حالت را با برگشت به خواندنِ تک‌به‌تکِ `readTabRows` (که تبِ ناموجود را
 * خودش «خالی» حساب می‌کند) جبران می‌کند، تا یک تبِ تازه یا هنوز‌نساخته باعث
 * گم‌شدنِ داده‌ی تب‌های دیگر نشود.
 */
export async function readTabRowsBatch(
  spreadsheetId: string,
  tabs: string[]
): Promise<Record<string, TenantRow[]>> {
  try {
    const ranges = tabs.map((tab) => `${quoteTab(tab)}!A:B`);
    const results = await readSheetRanges(spreadsheetId, ranges);
    const out: Record<string, TenantRow[]> = {};
    tabs.forEach((tab, i) => { out[tab] = rowsFromValues(results[i] ?? []); });
    return out;
  } catch (err) {
    if (!isMissingTabError(err)) throw err;
    const out: Record<string, TenantRow[]> = {};
    await Promise.all(tabs.map(async (tab) => { out[tab] = await readTabRows(spreadsheetId, tab); }));
    return out;
  }
}

/** 1-based row number of a key in column A, or -1. */
async function findRow(spreadsheetId: string, tab: string, key: string): Promise<number> {
  let rows: string[][];
  try {
    rows = await readSheet(spreadsheetId, `${quoteTab(tab)}!A:A`);
  } catch (err) {
    // تبِ ناموجود یعنی کلید هم آنجا نیست. صداکننده (`upsertRow`) از قبل
    // `ensureHeader` را زده، ولی `rowExists` مستقیم هم صدا زده می‌شود.
    if (isMissingTabError(err)) return -1;
    throw err;
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]?.[0] === key) return i + 1;
  }
  return -1;
}

export async function rowExists(spreadsheetId: string, tab: string, key: string): Promise<boolean> {
  return (await findRow(spreadsheetId, tab, key)) > 0;
}

/** Ensure the [key, value] header exists (creates the tab if missing). */
async function ensureHeader(spreadsheetId: string, tab: string): Promise<void> {
  const tabs = await listTabs(spreadsheetId);
  if (!tabs.includes(tab)) {
    await addTab(spreadsheetId, tab);
    return;
  }
  const head = await readSheet(spreadsheetId, `${quoteTab(tab)}!A1:B1`);
  if (!head.length || head[0]?.[0] !== "key") {
    await writeSheet(spreadsheetId, `${quoteTab(tab)}!A1`, [["key", "value"]]);
  }
}

/** Insert or update one key/value row. Returns whether it was created. */
export async function upsertRow(
  spreadsheetId: string,
  tab: string,
  key: string,
  value: unknown
): Promise<{ created: boolean }> {
  await ensureHeader(spreadsheetId, tab);
  const jsonValue = serializeValue(value);
  const rowNum = await findRow(spreadsheetId, tab, key);
  if (rowNum > 0) {
    await writeSheet(spreadsheetId, `${quoteTab(tab)}!A${rowNum}`, [[key, jsonValue]]);
    return { created: false };
  }
  await appendSheet(spreadsheetId, tab, [[key, jsonValue]]);
  return { created: true };
}

/**
 * Delete one row by key (read → filter → write-then-trim, preserving header).
 *
 * Write first, clear the surplus tail second — never the reverse. Clearing the
 * whole range before rewriting it leaves the tenant's tab empty for the
 * duration of a network round trip, and anything that goes wrong in that
 * window (crash, dropped connection, Sheets rate-limit) destroys the tab with
 * nothing to roll back to. Same fix as `deleteKVByKey` in sheetsSync.ts, which
 * had the identical bug.
 */
export async function deleteRow(spreadsheetId: string, tab: string, key: string): Promise<boolean> {
  let rows: string[][];
  try {
    rows = await readSheet(spreadsheetId, `${quoteTab(tab)}!A:B`);
  } catch (err) {
    if (isMissingTabError(err)) return false; // تبی نیست، پس چیزی برای حذف نیست
    throw err;
  }
  if (rows.length <= 1) return false;
  const kept = rows.filter((r, i) => i === 0 || r[0] !== key);
  if (kept.length === rows.length) return false; // key not found
  await writeSheet(spreadsheetId, `${quoteTab(tab)}!A1`, kept);
  await clearSheet(spreadsheetId, `${quoteTab(tab)}!A${kept.length + 1}:B`);
  return true;
}

/** فقط برای تست. */
export const __testables = { parseCell, healSheetsBoolean };
