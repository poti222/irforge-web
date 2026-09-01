import crypto from "crypto";
import { google } from "googleapis";
import { logger } from "./logger.js";

/**
 * IRFORGE_POSTGRES_FULL_MIGRATION_PROMPT, pg-migration checkpoint — item 3.
 *
 * `botConfig.ts::sendBotConfigError` mints its own correlation id when a
 * route's catch block hands it an error — but a live incident showed zero
 * of those ids anywhere in 156 real error-log entries for the exact Sheets
 * quota/permission failures this was built for, even though every route
 * genuinely does route through it. Whatever the deployment-level cause
 * turns out to be, the *log lines that actually carry the useful detail*
 * (spreadsheetId, range, the real Google error) are minted right here, one
 * level below sendBotConfigError, and today carry no id linking them to
 * whatever (if anything) the client eventually sees. Stamping the id onto
 * the error at the moment it's first observed — and having
 * sendBotConfigError reuse it instead of minting a disconnected second one
 * — means the low-level diagnostic line and the client-facing id are
 * guaranteed to be the same string regardless of what happens in between.
 */
function attachCorrelationId(err: unknown): string {
  const id = crypto.randomUUID();
  try {
    (err as { correlationId?: string }).correlationId = id;
  } catch {
    // err isn't extensible (frozen, or a primitive thrown as an error) —
    // the id still gets logged and returned, just can't ride along on err.
  }
  return id;
}

// ─── Setup ─────────────────────────────────────────────────────────────────
// In Railway, set these env vars:
//   GOOGLE_CREDENTIALS_JSON       → (preferred, unified across all three
//     services) full service-account JSON as a single-line string. Parsed
//     for `client_email` / `private_key`.
//   GOOGLE_SERVICE_ACCOUNT_EMAIL  → (legacy fallback) service account email
//   GOOGLE_SERVICE_ACCOUNT_KEY    → (legacy fallback) private key (with \n
//     as literal \n) — only read if GOOGLE_CREDENTIALS_JSON isn't set.
//   SHEETS_<NAME>_ID              → sheet ID for each named spreadsheet.
//     This project uses exactly two: SHEETS_DATA_ID and SHEETS_REGISTRY_ID
//     (see sheetsSync.ts for how entities map to tabs within SHEETS_DATA_ID,
//     and for the REGISTRY_SPREADSHEET_ID unified-name fallback).
//     getSheetId() below is generic and works for any SHEETS_<NAME>_ID you add.

/**
 * Parse `client_email` / `private_key` out of a full service-account JSON
 * string (the `GOOGLE_CREDENTIALS_JSON` unified format shared with
 * mainbot/support-bot). Handles both a real downloaded key file (private_key
 * already contains literal newlines) and a minified single-line env var
 * (private_key contains the two-character escape `\n`).
 */
function parseCredentialsJson(raw: string): { email: string; key: string } {
  let parsed: { client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      "GOOGLE_CREDENTIALS_JSON is set but is not valid JSON. It must be the full service-account key file contents as a single string."
    );
  }
  const { client_email, private_key } = parsed;
  if (!client_email || !private_key) {
    throw new Error(
      "GOOGLE_CREDENTIALS_JSON is missing client_email or private_key."
    );
  }
  return { email: client_email, key: private_key.replace(/\\n/g, "\n") };
}

function resolveCredentials(): { email: string; key: string } {
  const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;

  let email: string | undefined;
  let key: string | undefined;

  if (credentialsJson) {
    // Preferred path: unified GOOGLE_CREDENTIALS_JSON (same var name used
    // by mainbot and support-bot).
    ({ email, key } = parseCredentialsJson(credentialsJson));
  } else {
    // Legacy fallback: split email/key vars.
    email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n");
  }

  if (!email || !key) {
    throw new Error(
      "Google Sheets not configured. Set GOOGLE_CREDENTIALS_JSON (preferred), or GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_KEY (legacy)."
    );
  }

  return { email, key };
}

function getAuth() {
  const { email, key } = resolveCredentials();
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: key,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

export function getSheetsClient() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

/**
 * The service account's own email — not a secret, this is the identity Google
 * shows tenants in a sheet's Share dialog. Used for architecture/incident
 * diagnostics (IRFORGE_POSTGRES_FULL_MIGRATION_PROMPT pg-migration checkpoint):
 * telling an operator *which* Google identity needs to be re-added as an
 * editor is the actual actionable fix for a "caller does not have permission"
 * error — the raw error message alone doesn't name it.
 */
export function getActiveServiceAccountEmail(): string {
  return resolveCredentials().email;
}

/** List every tab (worksheet) title in a spreadsheet. */
export async function listTabs(spreadsheetId: string): Promise<string[]> {
  const cacheKey = `${spreadsheetId}::tabs`;
  const cached = cacheGet<string[]>(cacheKey);
  if (cached) return cached;
  try {
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties.title",
    });
    const titles = (res.data.sheets ?? [])
      .map((s) => s.properties?.title)
      .filter((t): t is string => Boolean(t));
    cacheSet(cacheKey, titles);
    return titles;
  } catch (err) {
    const correlationId = attachCorrelationId(err);
    logger.error({ err, spreadsheetId, correlationId }, "listTabs error");
    throw err;
  }
}

/** Create a new tab; seeds the [key, value] header. No-op if it already exists. */
export async function addTab(spreadsheetId: string, title: string): Promise<void> {
  const existing = await listTabs(spreadsheetId);
  if (existing.includes(title)) return;
  const sheets = getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  await writeSheet(spreadsheetId, `${quoteTab(title)}!A1`, [["key", "value"]]);
}

/** Quote a tab name for A1 notation (handles spaces / specials). */
export function quoteTab(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}

/**
 * Rename a spreadsheet's title (mirrors the bot's `rename_spreadsheet` →
 * "IrForge — <name>"). Uses the Sheets API's updateSpreadsheetProperties, which
 * only needs the spreadsheets scope (no Drive scope required).
 */
export async function renameSpreadsheet(spreadsheetId: string, title: string): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ updateSpreadsheetProperties: { properties: { title }, fields: "title" } }],
    },
  });
}

/** Whether the service account can open a spreadsheet (used to validate a pasted ID). */
export async function sheetIsAccessible(spreadsheetId: string): Promise<boolean> {
  try {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.get({ spreadsheetId, fields: "spreadsheetId" });
    return true;
  } catch {
    return false;
  }
}

export interface SheetAccessDiagnosis {
  ok: boolean;
  serviceAccountEmail: string;
  httpStatus?: number;
  googleReason?: string;
  message?: string;
}

/**
 * A live, uncached (bypasses the read cache entirely — this must reflect
 * the API's answer right now, not a memoized old one) check of whether the
 * active service account can currently open a spreadsheet, plus enough
 * detail to tell "access was revoked on a sheet that still exists" (403,
 * reason usually `PERMISSION_DENIED` or `forbidden`) apart from "the sheet
 * itself is gone" (404, reason `notFound`) — the two failure modes need
 * completely different fixes (re-share vs. nothing recoverable) and the
 * plain error message alone ("The caller does not have permission") reads
 * identically for both to a human skimming logs.
 */
/**
 * Pure extraction of the fields diagnoseSheetAccess needs out of a raw
 * error thrown by googleapis/gaxios — split out so the "which shape means
 * revoked vs. deleted" logic is unit-testable without a live network call
 * or real credentials (see sheetsAccessDiagnosis.test.mjs).
 */
export function describeSheetsError(err: unknown, serviceAccountEmail: string): SheetAccessDiagnosis {
  const e = err as {
    code?: number | string;
    message?: string;
    response?: { status?: number; data?: { error?: { status?: string; errors?: { reason?: string }[] } } };
  };
  const httpStatus = e.response?.status ?? (typeof e.code === "number" ? e.code : undefined);
  const googleReason = e.response?.data?.error?.status ?? e.response?.data?.error?.errors?.[0]?.reason;
  return { ok: false, serviceAccountEmail, httpStatus, googleReason, message: e.message };
}

export async function diagnoseSheetAccess(spreadsheetId: string): Promise<SheetAccessDiagnosis> {
  const serviceAccountEmail = getActiveServiceAccountEmail();
  try {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.get({ spreadsheetId, fields: "spreadsheetId" });
    return { ok: true, serviceAccountEmail };
  } catch (err) {
    return describeSheetsError(err, serviceAccountEmail);
  }
}

// ─── Sheet ID helpers ───────────────────────────────────────────────────────
// Returns the sheet ID for a named sheet.
// Usage: getSheetId("USERS") → reads env SHEETS_USERS_ID
export function getSheetId(name: string): string {
  const id = process.env[`SHEETS_${name.toUpperCase()}_ID`];
  if (!id) throw new Error(`Env var SHEETS_${name.toUpperCase()}_ID is not set`);
  return id;
}

// ─── Core operations ────────────────────────────────────────────────────────

/**
 * آیا این خطا یعنی «کردنشیال گوگل روی این سرور تنظیم نشده»؟
 *
 * محتمل‌ترین خطای پیکربندیِ کل این سامانه است، و تا امروز به‌شکل یک ۵۰۰ با
 * پیام «خطای غیرمنتظره روی سرور» بیرون می‌آمد — یعنی اپراتور هیچ سرنخی
 * نداشت که فقط یک متغیر محیطی جا افتاده. `getAuth()` این را با یک `Error`
 * ساده throw می‌کند، پس تنها راه تشخیصش متن پیام است.
 */
export function isSheetsNotConfiguredError(err: unknown): boolean {
  const message = String((err as { message?: string } | null)?.message ?? "");
  return message.includes("Google Sheets not configured") || message.includes("GOOGLE_CREDENTIALS_JSON");
}

/**
 * آیا این خطا یعنی «تبِ خواسته‌شده روی این اسپردشیت وجود ندارد»؟
 *
 * وقتی range به تبی اشاره کند که ساخته نشده، Sheets API یک **۴۰۰** با پیام
 * `Unable to parse range: 'forms'!A:B` برمی‌گرداند — نه ۴۰۴. از بیرون این با
 * «درخواستت بدشکل بود» فرق ندارد، برای همین تا امروز به‌عنوان یک خطای
 * غیرمنتظره بالا می‌رفت و کل سکشن سایت را با «خطای نامشخص سرور» می‌ترکاند
 * (فرم‌ها، آبجکت‌ها، ریلیشن‌ها — همه یک ریشه داشتند).
 *
 * تشخیص عمداً هم روی کد وضعیت و هم روی متن انجام می‌شود: یک ۴۰۰ـِ واقعی
 * (مثلاً range بدشکل به دلیل باگ خودمان) نباید بی‌صدا به «تب خالی» ترجمه شود.
 */
export function isMissingTabError(err: unknown): boolean {
  const anyErr = err as { code?: number; status?: number; message?: string } | null;
  if (!anyErr) return false;
  const status = anyErr.code ?? anyErr.status;
  if (status !== 400) return false;
  const message = String(anyErr.message ?? "");
  return message.includes("Unable to parse range");
}

// ─── Short-TTL read cache (IRFORGE_POSTGRES_FULL_MIGRATION_PROMPT, Phase 0) ──
//
// Root cause of "every bot section 500s": Google Sheets' "Read requests per
// minute per user" quota is shared across the site's one service account and
// every tenant's bot, and every read here — `readSheet`, `readSheetRanges`,
// `listTabs` — hit the API fresh with zero caching. A single page (forms,
// commands, panels, bot users, plugins each doing their own reads) or a few
// concurrent users burns through the per-minute budget in seconds; a prior
// pass (`dd71f6f`) batched the one worst offender (`getLiveBotCounts`) but
// left every other call site — which is most of them — unprotected. Railway
// logs confirmed this live: dozens of "Quota exceeded ... Read requests per
// minute" GaxiosErrors across forms/commands/panels/bot-users/plugins/health,
// not a single tokenCrypto/BOT_TOKEN_ENCRYPTION_KEY error anywhere.
//
// This cache doesn't change correctness beyond a short staleness window —
// writes bust every cached entry for that spreadsheet immediately — it only
// collapses the many near-simultaneous re-reads one page load or a burst of
// users produces into one real API call.
const READ_CACHE_TTL_MS = 15_000;
type ReadCacheEntry = { at: number; value: unknown };
const readCache = new Map<string, ReadCacheEntry>();

function cacheGet<T>(key: string): T | undefined {
  const hit = readCache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > READ_CACHE_TTL_MS) {
    readCache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function cacheSet(key: string, value: unknown): void {
  readCache.set(key, { at: Date.now(), value });
}

/**
 * تب‌هایی که هرگز نباید کش شوند، حتی وقتی همه‌ی شرایط بالا برقرارند.
 *
 * این کش امروز فقط داخلِ یک پروسس است (سرویس `irforge-web` روی Railway با
 * **یک** replica دیپلوی شده — تأییدشده)، پس هیچ instance دومی نیست که
 * نوشته‌ی همین لحظه‌ی instance اول را نبیند. اگر روزی replica بیشتر شود،
 * این فرض می‌شکند: instance B تا ۱۵ ثانیه بعد از نوشتنِ instance A همچنان
 * مقدار کهنه می‌دهد — برای `bot_settings` بی‌ضرر است، برای موجودی یا
 * سفارش نه. این لیست همان محدودسازی است، مستقل از تعداد replica: تب‌های
 * پول/موجودی/سفارش هیچ‌وقت وارد کش نمی‌شوند، هر چند replica که باشد.
 */
const NEVER_CACHE_TABS = new Set([
  "orders",
  "wallet",
  "transactions",
  "payments",
  "catalog_items", // has stock_qty/track_stock
]);

/** `'tab_name'!A:B` → `tab_name` (reverses `quoteTab`'s `''`-escaping). Null if not a simple single-tab range. */
function tabNameFromRange(range: string): string | null {
  const match = /^'((?:[^']|'')*)'!/.exec(range);
  if (!match) return null;
  return match[1].replace(/''/g, "'");
}

function isCacheableRange(range: string): boolean {
  const tab = tabNameFromRange(range);
  return tab === null || !NEVER_CACHE_TABS.has(tab);
}

/** Drop every cached read for one spreadsheet — call after any write to it. */
export function invalidateReadCache(spreadsheetId: string): void {
  const prefix = `${spreadsheetId}::`;
  for (const key of readCache.keys()) {
    if (key.startsWith(prefix)) readCache.delete(key);
  }
}

/** Test-only: force every cache entry to expire regardless of TTL. */
export function __clearReadCacheForTests(): void {
  readCache.clear();
}

/** Test-only direct access to the cache primitives — no live Google call needed. */
export const __readCacheTestables = {
  cacheGet,
  cacheSet,
  readCache,
  tabNameFromRange,
  isCacheableRange,
  NEVER_CACHE_TABS,
};

/** Read all rows from a sheet. Returns string[][] */
export async function readSheet(
  spreadsheetId: string,
  range: string = "Sheet1"
): Promise<string[][]> {
  const cacheable = isCacheableRange(range);
  const cacheKey = `${spreadsheetId}::range::${range}`;
  if (cacheable) {
    const cached = cacheGet<string[][]>(cacheKey);
    if (cached) return cached;
  }
  try {
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const values = (res.data.values as string[][]) ?? [];
    if (cacheable) cacheSet(cacheKey, values);
    return values;
  } catch (err) {
    // تبِ ناموجود یک خطا نیست، یک «هنوز چیزی ننوشته‌ایم» است — و در سطح
    // خودِ readSheet هم لاگِ error نمی‌خواهد، وگرنه لاگ پر می‌شود از چیزی
    // که صداکننده‌اش (readTabRows) قرار است عادی مدیریتش کند.
    if (isMissingTabError(err)) {
      logger.debug({ spreadsheetId, range }, "readSheet: tab does not exist");
      throw err;
    }
    const correlationId = attachCorrelationId(err);
    logger.error({ err, spreadsheetId, range, correlationId }, "readSheet error");
    throw err;
  }
}

/**
 * چند range از یک اسپردشیت را در **یک** فراخوانی API می‌خواند — نه یکی به
 * ازای هر range. سهمیه‌ی خواندنِ Sheets API («Read requests per minute per
 * user») روی سطح خودِ سرویس‌اکانت مشترک است، یعنی بینِ همه‌ی بات‌های همه‌ی
 * کاربرانِ سایت تقسیم می‌شود؛ جایی مثل `getLiveBotCounts` (routes/bots.ts)
 * که به ازای هر بات ۳ تب را جدا می‌خواند، روی فهرستِ باتِ یک کاربر با N بات
 * یعنی N×۳ درخواستِ خواندنِ هم‌زمان — دقیقاً همان چیزی که خطای
 * «Quota exceeded ... Read requests per minute» را رقم زد. اینجا همان ۳ تب
 * با یک HTTP request خوانده می‌شود، پس هزینه‌ی سهمیه‌اش هم فقط یکی است.
 *
 * ترتیبِ خروجی دقیقاً همانِ `ranges` ورودی است، نه چیزی که گوگل در
 * `valueRanges[].range` برمی‌گرداند (که می‌تواند فرمتِ A1 را کمی فرق بنویسد) —
 * پس اندیس، نه matching رشته‌ای.
 */
export async function readSheetRanges(
  spreadsheetId: string,
  ranges: string[]
): Promise<string[][][]> {
  // If ANY range in the batch touches a never-cache tab, skip caching the
  // whole batch — safer than trying to cache the other ranges piecemeal.
  const cacheable = ranges.every(isCacheableRange);
  const cacheKey = `${spreadsheetId}::ranges::${ranges.join("|")}`;
  if (cacheable) {
    const cached = cacheGet<string[][][]>(cacheKey);
    if (cached) return cached;
  }
  try {
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });
    const valueRanges = res.data.valueRanges ?? [];
    const out = ranges.map((_, i) => (valueRanges[i]?.values as string[][]) ?? []);
    if (cacheable) cacheSet(cacheKey, out);
    return out;
  } catch (err) {
    // batchGet کلِ درخواست را رد می‌کند اگر حتی یکی از range ها نامعتبر باشد
    // (مثلاً تبی که هنوز ساخته نشده) — isMissingTabError پایین همین فایل این
    // را تشخیص می‌دهد؛ صداکننده (readTabRowsBatch در tenantSheets.ts) در آن
    // حالت به خواندنِ تک‌به‌تکِ قدیمی برمی‌گردد، نه اینکه هر ۳ تب را گم کند.
    if (!isMissingTabError(err)) {
      const correlationId = attachCorrelationId(err);
      logger.error({ err, spreadsheetId, ranges, correlationId }, "readSheetRanges error");
    }
    throw err;
  }
}

/**
 * چرا `RAW` و نه `USER_ENTERED` — ریشه‌ی چند باگ گزارش‌شده.
 * ─────────────────────────────────────────────────────────────────────────────
 * `USER_ENTERED` یعنی «این را طوری تفسیر کن که انگار کاربر در سلول تایپش
 * کرده». قرارداد شیت تننت اما این است که هر سلول **دقیقاً** خروجی
 * `JSON.stringify(value)` باشد و طرف مقابل با `JSON.parse` بخواندش. این دو
 * با هم نمی‌سازند:
 *
 *   - `JSON.stringify(false)` = `false` → گوگل آن را یک سلول **بولی** واقعی
 *     می‌کند. موقع خواندن `FALSE` برمی‌گردد، `JSON.parse("FALSE")` می‌شکند و
 *     مقدار به‌صورت رشته‌ی `"FALSE"` می‌ماند. در پایتون `bool("FALSE")` برابر
 *     `True` است — یعنی هر تنظیم بولی که از سایت خاموش شود، **در بات روشن
 *     می‌ماند**. پیام خوش‌آمدی که خاموش نمی‌شد دقیقاً همین بود.
 *   - همان رشته‌ی `"TRUE"` بعداً از سایت هم خوانده می‌شود و ولیدیشن با
 *     «مقدار watermark_enabled باید true یا false باشد» ذخیره را رد می‌کند —
 *     بدون اینکه کاربر اصلاً آن فیلد را لمس کرده باشد.
 *   - و سلولی که با `=` شروع شود به یک **فرمول** تبدیل می‌شد؛ یعنی متنی که
 *     کاربر در پیام بات نوشته، در شیت اجرا می‌شد.
 *
 * `RAW` سلول را همان‌طور که فرستاده شده می‌نویسد — همان کاری که خودِ بات با
 * gspread می‌کند (پیش‌فرضش `RAW` است). این تنها حالتی است که رفت‌وبرگشتِ
 * JSON را سالم نگه می‌دارد.
 */
const VALUE_INPUT_OPTION = "RAW";

/** Overwrite a range with new values */
export async function writeSheet(
  spreadsheetId: string,
  range: string,
  values: (string | number | boolean | null)[][]
): Promise<void> {
  try {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: VALUE_INPUT_OPTION,
      requestBody: { values },
    });
    invalidateReadCache(spreadsheetId);
  } catch (err) {
    const correlationId = attachCorrelationId(err);
    logger.error({ err, spreadsheetId, range, correlationId }, "writeSheet error");
    throw err;
  }
}

/** Append rows to a sheet */
export async function appendSheet(
  spreadsheetId: string,
  range: string,
  values: (string | number | boolean | null)[][]
): Promise<void> {
  try {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: VALUE_INPUT_OPTION,
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });
    invalidateReadCache(spreadsheetId);
  } catch (err) {
    const correlationId = attachCorrelationId(err);
    logger.error({ err, spreadsheetId, range, correlationId }, "appendSheet error");
    throw err;
  }
}

/** Clear a range */
export async function clearSheet(
  spreadsheetId: string,
  range: string
): Promise<void> {
  try {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.clear({ spreadsheetId, range });
    invalidateReadCache(spreadsheetId);
  } catch (err) {
    const correlationId = attachCorrelationId(err);
    logger.error({ err, spreadsheetId, range, correlationId }, "clearSheet error");
    throw err;
  }
}

/**
 * یک اسپردشیت رو کاملاً ریست می‌کنه: همه‌ی تب‌های موجود رو حذف می‌کنه و
 * فقط یه تب خالی به اسم "Sheet1" جاش می‌ذاره — دقیقاً مثل حالتی که یه
 * اسپردشیت تازه ساخته شده. برای جلوگیری از نشت دیتای بات قبلی به بات
 * بعدی، هر جا شیتی از یه بات آزاد می‌شه (حذف بات یا release دستی توسط
 * سوپرادمین) باید این تابع صدا زده بشه.
 */
export async function resetSpreadsheet(spreadsheetId: string): Promise<void> {
  try {
    const sheets = getSheetsClient();
    const current = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties(sheetId,title)",
    });
    const existingSheets = current.data.sheets ?? [];
    const tempTitle = `_reset_${Date.now()}`;

    // اول یه تب موقت خالی اضافه می‌کنیم، بعد همه‌ی تب‌های قبلی رو حذف
    // می‌کنیم — این ترتیب لازمه چون گوگل‌شیت نمی‌ذاره آخرین تب حذف بشه.
    const addResult = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          { addSheet: { properties: { title: tempTitle } } },
          ...existingSheets
            .filter((s) => s.properties?.sheetId != null)
            .map((s) => ({ deleteSheet: { sheetId: s.properties!.sheetId! } })),
        ],
      },
    });

    const newSheetId = addResult.data.replies?.[0]?.addSheet?.properties?.sheetId;
    if (newSheetId != null) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: { sheetId: newSheetId, title: "Sheet1" },
                fields: "title",
              },
            },
          ],
        },
      });
    }

    // شیت آزادشده باید همون لحظه، قبل از برگشتن به Pool، کامل تب‌بندی بشه —
    // نه موقع assign به بات بعدی. اگه اینجا نسازیمشون، بات بعدی که این شیت رو
    // می‌گیره یه شیت خالیِ فقط-Sheet1 تحویل می‌گیره و اولین درخواستی که یه تب
    // (مثل «panels») رو می‌خونه با خطای «تب پیدا نشد» گوگل‌شیت می‌ترکه.
    await ensureAllTenantTabs(spreadsheetId);
    invalidateReadCache(spreadsheetId);
  } catch (err) {
    const correlationId = attachCorrelationId(err);
    logger.error({ err, spreadsheetId, correlationId }, "resetSpreadsheet error");
    throw err;
  }
}

// ─── Tenant-tab provisioning ────────────────────────────────────────────────

/**
 * هر تبی که یک بخش از سایت یا بات به‌عنوان یک entity-tab می‌خواند/می‌نویسد.
 * وقتی شیتی تازه (خالی، فقط با «Sheet1») به بات جدیدی می‌رسد — چه از Pool، چه
 * با پیست دستی ID توسط سوپرادمین — این تب‌ها هنوز رویش نیستند، و اولین
 * درخواستی که یکی از آن‌ها را می‌خواند (مثلاً پنل‌ها) روی خطای «تب پیدا نشد»ِ
 * گوگل‌شیت می‌ترکد چون `readTabRows` مستقیم از یک range با نام تب ناموجود
 * می‌خواند.
 *
 * این لیست باید با تمام ثابت‌های `*_TAB` پخش‌شده در routes/*.ts و lib/*.ts
 * همگام بماند: panelOps.ts (panels, custom_commands), botConfig.ts
 * (bot_settings), botAdmins.ts (admins), botForms.ts (forms),
 * botLanguage.ts (text_keys, text_values), botObjects.ts (object_schemas),
 * botOrders.ts (payments), botRelations.ts (relation_definitions,
 * relation_links), botSupportTickets.ts (tickets, ticket_messages),
 * botUsers.ts (users), botWorkflows.ts (workflows, workflow_runs),
 * discountStore.ts (discounts, discount_redemptions).
 */
export const ALL_TENANT_TABS: readonly string[] = [
  "bot_settings",
  "panels",
  "custom_commands",
  "admins",
  "forms",
  "text_keys",
  "text_values",
  "object_schemas",
  "payments",
  "relation_definitions",
  "relation_links",
  "tickets",
  "ticket_messages",
  "users",
  "workflows",
  "workflow_runs",
  "discounts",
  "discount_redemptions",
];

/**
 * هر تبی از `titles` که هنوز روی شیت نیست را می‌سازد — همه با هم در یک
 * batchUpdate (نه یکی‌یکی مثل `addTab`، که برای این تعداد تب کند و پرخطا
 * می‌شود)، بعد هدر `[key, value]` هرکدام را می‌نویسد. برای تب‌های موجود کاری
 * نمی‌کند، پس صدا زدنش همیشه امن است (idempotent).
 */
export async function ensureTabsExist(spreadsheetId: string, titles: readonly string[]): Promise<void> {
  const existing = await listTabs(spreadsheetId);
  const missing = titles.filter((t) => !existing.includes(t));
  if (missing.length === 0) return;

  const sheets = getSheetsClient();
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
  } catch (err) {
    logger.error({ err, spreadsheetId, missing }, "ensureTabsExist: batch addSheet failed");
    throw err;
  }

  // هدرها را جدا می‌نویسیم (values.update بچ نمی‌گیرد) — خطای هدر یک تب نباید
  // جلوی ساخته‌شدن/هدرگیریِ بقیه را بگیرد، تب بی‌هدر هم به مراتب بهتر از
  // تبِ اصلاً‌ناموجود است.
  for (const title of missing) {
    try {
      await writeSheet(spreadsheetId, `${quoteTab(title)}!A1`, [["key", "value"]]);
    } catch (err) {
      logger.error({ err, spreadsheetId, title }, "ensureTabsExist: header write failed");
    }
  }
}

/** میان‌بر: همه‌ی تب‌های ثابت شناخته‌شده‌ی تننت را می‌سازد (`ALL_TENANT_TABS`). */
export async function ensureAllTenantTabs(spreadsheetId: string): Promise<void> {
  await ensureTabsExist(spreadsheetId, ALL_TENANT_TABS);
}

/** Read sheet as array of objects using first row as headers */
export async function readSheetAsObjects(
  spreadsheetId: string,
  range: string = "Sheet1"
): Promise<Record<string, string>[]> {
  const rows = await readSheet(spreadsheetId, range);
  if (rows.length < 1) return [];
  const [headers, ...data] = rows;
  return data.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? "";
    });
    return obj;
  });
}

/** Write array of objects back to sheet (headers from first object's keys) */
export async function writeSheetFromObjects(
  spreadsheetId: string,
  range: string,
  objects: Record<string, unknown>[]
): Promise<void> {
  if (objects.length === 0) return;
  const headers = Object.keys(objects[0]);
  const rows = objects.map((o) => headers.map((h) => String(o[h] ?? "")));
  await writeSheet(spreadsheetId, range, [headers, ...rows]);
}
