/**
 * botConfig.ts — لایه‌ی واحدِ دسترسی سایت به دیتای بات.
 * ─────────────────────────────────────────────────────────────────────────────
 * روی `tenantSheets.ts` سوار است، نه جایگزینش: `tenantSheets` سطح «سطرِ خام
 * key/value» را می‌دهد، این ماژول سطح «entity» را — با ولیدیشن مالکیت،
 * پیش‌فرض‌های `models.py`، و باطل‌کردن خودکار کش بات بعد از هر نوشتن.
 *
 * همه‌ی روت‌های بات‌ادمین (`botSettings.ts`, `botPanels.ts`, `botForms.ts`, ...)
 * فقط از اینجا می‌خوانند/می‌نویسند و هرگز مستقیم `tenantSheets` را صدا نمی‌زنند.
 *
 * سه قانون غیرقابل‌مذاکره که اینجا اجرا می‌شوند:
 *   1. هیچ‌وقت کل تب بازنویسی نمی‌شود — فقط `upsertRow` تک‌کلیدی (باگ B11:
 *      `SheetsManager.write()` بات کل تب را clear می‌کند و کلیدهای ناشناخته‌ای
 *      مثل `__plugin_states__` را می‌کشد).
 *   2. بعد از هر نوشتن موفق، کش L2 بات باطل می‌شود (`botCacheBust.ts`).
 *   3. قبل از هر خواندن/نوشتنِ یک entity، پرچم cutover بررسی می‌شود — اگر آن
 *      entity به Postgres مهاجرت کرده باشد، نوشتنِ ما روی شیت بی‌اثر است و
 *      باید ۴۰۹ بدهیم، نه اینکه کاربر فکر کند ذخیره شد.
 */
import pg from "pg";
import { db, botsTable, usersTable, botManagersTable } from "@workspace/db";
import { eq, and, or, exists, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { readTabRows, upsertRow, deleteRow, listTabs } from "./tenantSheets.js";
import { isSheetsNotConfiguredError } from "./sheets.js";
import { bustTabCache, bustTabsCache } from "./botCacheBust.js";
import {
  defaultBotSettings,
  defaultWorkingHours,
  defaultAntiFlood,
  defaultPaymentConfig,
  nowIso,
  type BotSettings,
} from "./botTypes.js";

const { Pool } = pg;

/** تب `bot_settings` — کلید هر سطر نام یک فیلد است، نه یک id. */
export const SETTINGS_TAB = "bot_settings";

// ─── خطای HTTP‌دار ──────────────────────────────────────────────────────────

/**
 * خطایی که روت‌ها مستقیم به پاسخ HTTP تبدیل می‌کنند. `code` اختیاری است و
 * کلاینت روی آن شرط می‌گذارد (مثلاً `entity_on_postgres`).
 */
export class BotConfigError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "BotConfigError";
    this.status = status;
    this.code = code;
  }
}

/** هندلر خطای مشترک همه‌ی روت‌های بات‌ادمین. */
export function sendBotConfigError(res: any, err: any, fallback: string): void {
  if (err instanceof BotConfigError) {
    res.status(err.status).json(err.code ? { error: err.message, code: err.code } : { error: err.message });
    return;
  }
  if (err && typeof err.status === "number" && typeof err.error === "string") {
    res.status(err.status).json({ error: err.error });
    return;
  }
  // نبودِ کردنشیال گوگل، محتمل‌ترین خطای پیکربندی این سامانه است و تا امروز
  // به‌شکل «خطای غیرمنتظره» بیرون می‌آمد — اپراتور هیچ سرنخی نداشت که فقط یک
  // متغیر محیطی جا افتاده. ۵۰۳ چون سرویس در دسترس نیست، نه اینکه درخواست بد
  // بوده.
  if (isSheetsNotConfiguredError(err)) {
    logger.error({ err }, "Google Sheets credentials are not configured");
    res.status(503).json({
      error:
        "اتصال به Google Sheets روی سرور تنظیم نشده است (GOOGLE_CREDENTIALS_JSON). تا وقتی این متغیر محیطی پر نشود، هیچ داده‌ای از شیت بات خوانده یا نوشته نمی‌شود.",
      code: "sheets_not_configured",
    });
    return;
  }

  logger.error({ err }, fallback);
  res.status(500).json({ error: "خطای غیرمنتظره روی سرور. لطفاً دوباره تلاش کنید." });
}

// ─── seam تست ───────────────────────────────────────────────────────────────

/**
 * تنها نقطه‌ای که این ماژول به Google Sheets وصل می‌شود. تست‌ها یک لایه‌ی
 * جعلی روی همین شیء `Object.assign` می‌کنند تا بدون کردنشیال واقعی اجرا شوند
 * (قانون ۶ پرامپت: هیچ فراخوانی واقعی به Google در محیط توسعه).
 */
export const sheetLayer = {
  readTabRows,
  upsertRow,
  deleteRow,
  listTabs,
};

// ─── resolveBotSheet ────────────────────────────────────────────────────────

export type ResolvedBotSheet = {
  botId: string;
  spreadsheetId: string;
  botName: string;
  isSuperAdmin: boolean;
};

async function getRole(userId: string): Promise<string> {
  const [u] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return u?.role ?? "user";
}

/**
 * بات را به اسپردشیتش resolve می‌کند و مالکیت را enforce می‌کند.
 * رفتار دقیقاً مثل `resolveTarget` در `routes/database.ts`:
 *   404 اگر بات وجود ندارد یا مال این کاربر نیست،
 *   409 اگر بات هنوز شیت اختصاصی نگرفته.
 * سوپرادمین به همه‌ی بات‌ها دسترسی دارد (همان قرارداد منوی دیتابیس).
 */
export async function resolveBotSheet(userId: string, botId: string): Promise<ResolvedBotSheet> {
  const role = await getRole(userId);
  const isSuperAdmin = role === "super_admin";

  // مالک، یا سوپرادمین، یا کسی که مالک با کد ادمین دسترسی مدیریت داده
  // (`bot_managers`). دسترسی واگذارشده فقط همین پنل مدیریت را باز می‌کند؛
  // عملیات مالکیتی (حذف بات، ساخت کد تازه) از `requireBotOwnership` رد
  // می‌شوند که عمداً دست‌نخورده مانده و همچنان فقط مالک را می‌پذیرد.
  const where = isSuperAdmin
    ? eq(botsTable.id, botId)
    : and(
        eq(botsTable.id, botId),
        or(
          eq(botsTable.userId, userId),
          exists(
            db
              .select({ one: sql`1` })
              .from(botManagersTable)
              .where(
                and(eq(botManagersTable.botId, botId), eq(botManagersTable.userId, userId)),
              ),
          ),
        ),
      );
  const [bot] = await db
    .select({ id: botsTable.id, name: botsTable.name, sheetId: botsTable.sheetId })
    .from(botsTable)
    .where(where)
    .limit(1);
  if (!bot) throw new BotConfigError(404, "این بات پیدا نشد یا مال شما نیست.", "bot_not_found");
  if (!bot.sheetId)
    throw new BotConfigError(
      409,
      "این بات هنوز شیت اختصاصی ندارد. تا وقتی شیت تخصیص داده نشده، تنظیمات بات قابل ویرایش نیست.",
      "no_sheet"
    );
  return { botId: bot.id, spreadsheetId: bot.sheetId, botName: bot.name, isSuperAdmin };
}

/**
 * جهتِ برعکسِ `resolveBotSheet`: از spreadsheetId به بات.
 *
 * IRFORGE_PROMPT_V3 Phase 16 — برای اندپوینت‌های داخلیِ «بات به سایت زنگ
 * می‌زند» که فقط همین شناسه را دارند، نه UUID سایت (`bots.id`). دقیقاً
 * همین نبود یک نگاشتِ برعکس، همان گاف مستندشده‌ی
 * `utils/expiry_worker.py::_purge_on_website` سمت بات است — این اندپوینت
 * از اول به‌جای شناسه‌ی اشتباه، همین را می‌گیرد.
 */
export async function resolveBotBySpreadsheetId(
  spreadsheetId: string,
): Promise<{ botId: string; ownerUserId: string } | null> {
  const [bot] = await db
    .select({ id: botsTable.id, userId: botsTable.userId })
    .from(botsTable)
    .where(eq(botsTable.sheetId, spreadsheetId))
    .limit(1);
  return bot ? { botId: bot.id, ownerUserId: bot.userId } : null;
}

/** صاحبِ بات + هر مدیری که با کد ادمین دسترسیِ مدیریت گرفته (`bot_managers`). */
export async function getBotOwnerAndManagerIds(botId: string, ownerUserId: string): Promise<string[]> {
  const managers = await db
    .select({ userId: botManagersTable.userId })
    .from(botManagersTable)
    .where(eq(botManagersTable.botId, botId));
  return [...new Set([ownerUserId, ...managers.map((m) => m.userId)])];
}

// ─── entityهای عمومی (کلید = id) ────────────────────────────────────────────

export type EntityRow<T> = { key: string; value: T };

/**
 * همه‌ی سطرهای یک تب. سطرهایی که مقدارشان object نیست (سلولِ غیر-JSON) هم
 * برگردانده می‌شوند — بات هم همان رشته‌ی خام را تحمل می‌کند و ما حق نداریم
 * بی‌سروصدا دورشان بریزیم.
 */
export async function listEntity<T = unknown>(spreadsheetId: string, tab: string): Promise<EntityRow<T>[]> {
  const rows = await sheetLayer.readTabRows(spreadsheetId, tab);
  return rows.map((r) => ({ key: r.key, value: r.value as T }));
}

export async function getEntity<T = unknown>(
  spreadsheetId: string,
  tab: string,
  key: string
): Promise<T | null> {
  const rows = await sheetLayer.readTabRows(spreadsheetId, tab);
  const hit = rows.find((r) => r.key === key);
  return hit ? (hit.value as T) : null;
}

/** یک سطر را می‌نویسد (JSON) و کش بات را باطل می‌کند. */
export async function putEntity(
  spreadsheetId: string,
  tab: string,
  key: string,
  value: unknown
): Promise<{ created: boolean }> {
  const result = await sheetLayer.upsertRow(spreadsheetId, tab, key, value);
  await bustTabCache(spreadsheetId, tab);
  return result;
}

/** چند سطر پشت‌سرهم (ترتیبی، چون Sheets روی نوشتن موازی race می‌دهد). */
export async function putEntities(
  spreadsheetId: string,
  tab: string,
  entries: Array<{ key: string; value: unknown }>
): Promise<void> {
  for (const e of entries) {
    await sheetLayer.upsertRow(spreadsheetId, tab, e.key, e.value);
  }
  await bustTabCache(spreadsheetId, tab);
}

export async function removeEntity(spreadsheetId: string, tab: string, key: string): Promise<boolean> {
  const ok = await sheetLayer.deleteRow(spreadsheetId, tab, key);
  if (ok) await bustTabCache(spreadsheetId, tab);
  return ok;
}

/** باطل‌کردن دستی کش چند تب — بعد از عملیات چندتبی (مثل restore). */
export async function bustTabs(spreadsheetId: string, tabs: string[]): Promise<void> {
  await bustTabsCache(spreadsheetId, tabs);
}

// ─── bot_settings ───────────────────────────────────────────────────────────

/**
 * تنظیمات کامل بات، با پرکردن پیش‌فرض‌های `models.py::BotSettings` برای هر
 * کلیدی که هنوز روی شیت نوشته نشده. کلیدهای ناشناخته (مثل `__plugin_states__`)
 * در خروجی نمی‌آیند ولی روی شیت هم دست نمی‌خورند.
 */
export async function readSettings(spreadsheetId: string): Promise<BotSettings> {
  const rows = await sheetLayer.readTabRows(spreadsheetId, SETTINGS_TAB);
  const raw = new Map(rows.map((r) => [r.key, r.value]));
  const base = defaultBotSettings();
  const out: Record<string, unknown> = { ...base };

  for (const key of Object.keys(base)) {
    if (!raw.has(key)) continue;
    const value = raw.get(key);
    if (value === undefined || value === null) continue;
    out[key] = value;
  }

  // working_hours / anti_flood روی شیت ممکن است ناقص باشند (بات فقط کلیدهای
  // تغییرکرده را می‌نویسد) — با پیش‌فرض‌ها merge می‌شوند تا کلاینت همیشه شکل
  // کامل بگیرد.
  out.working_hours = {
    ...defaultWorkingHours(),
    ...(typeof out.working_hours === "object" && out.working_hours ? out.working_hours : {}),
  };
  out.anti_flood = {
    ...defaultAntiFlood(),
    ...(typeof out.anti_flood === "object" && out.anti_flood ? out.anti_flood : {}),
  };
  // IRFORGE_PAYMENT_SETTINGS_WEB_PROMPT Phase B2 — همان الگو: `payment_cfg`
  // روی شیت ممکن است فقط زیرمجموعه‌ای از ۸ فیلد را داشته باشد (یا اصلاً
  // نباشد)؛ merge با پیش‌فرض‌ها تضمین می‌کند کلاینت همیشه شکلِ کامل بگیرد،
  // و کلیدهای خارج از دامنه (`buy_buttons`, ...) که روی همین آبجکت زندگی
  // می‌کنند دست‌نخورده باقی می‌مانند چون spread شان می‌کنیم، نه فیلدبه‌فیلد.
  out.payment_cfg = {
    ...defaultPaymentConfig(),
    ...(typeof out.payment_cfg === "object" && out.payment_cfg ? out.payment_cfg : {}),
  };
  if (!Array.isArray(out.force_join_channels)) out.force_join_channels = [];
  if (out.home_panel_id === "") out.home_panel_id = null;

  return out as BotSettings;
}

/**
 * فقط کلیدهای داده‌شده را می‌نویسد — **کلیدبه‌کلید** (باگ B11). هر کلیدی که در
 * `partial` نیست، از جمله کلیدهای ناشناخته‌ای که سایت اصلاً نمی‌شناسد
 * (`__plugin_states__`, `payment_cfg`, ...)، دست‌نخورده روی شیت می‌ماند.
 * `updated_at` مثل `_save_settings` بات همیشه ست می‌شود.
 */
export async function patchSettings(
  spreadsheetId: string,
  partial: Partial<BotSettings> & Record<string, unknown>
): Promise<BotSettings> {
  const entries = Object.entries(partial).filter(([, v]) => v !== undefined);
  for (const [key, value] of entries) {
    await sheetLayer.upsertRow(spreadsheetId, SETTINGS_TAB, key, value);
  }
  await sheetLayer.upsertRow(spreadsheetId, SETTINGS_TAB, "updated_at", nowIso());
  await bustTabCache(spreadsheetId, SETTINGS_TAB);
  return readSettings(spreadsheetId);
}

// ─── cutover flags ──────────────────────────────────────────────────────────

/**
 * آینه‌ی `mainbot/utils/cutover_flags.py`. اگر یک entity به Postgres مهاجرت
 * کرده باشد (`use_db = true`)، بات دیگر آن را از شیت نمی‌خواند — پس نوشتنِ ما
 * روی شیت بی‌اثر است و باید صریح خطا بدهیم.
 *
 * دقیقاً مثل خود بات **fail-open** است: اگر `BUSINESS_DATABASE_URL` ست نباشد،
 * جدول وجود نداشته باشد، یا کوئری بخورد زمین → اجازه می‌دهیم و روی Sheets
 * می‌مانیم. کش ۶۰ ثانیه‌ای، هم‌اندازه‌ی `CACHE_TTL` بات.
 */
const CUTOVER_TTL_MS = 60_000;
let cutoverCache: Record<string, boolean> = {};
let cutoverLoadedAt = 0;
let cutoverPool: pg.Pool | null = null;
let cutoverPoolFailed = false;

function getCutoverPool(): pg.Pool | null {
  if (!process.env.BUSINESS_DATABASE_URL || cutoverPoolFailed) return null;
  if (cutoverPool) return cutoverPool;
  try {
    cutoverPool = new Pool({
      connectionString: process.env.BUSINESS_DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
    });
    cutoverPool.on("error", (err) => {
      logger.warn({ err }, "cutoverFlags: idle client error (ignored)");
    });
    return cutoverPool;
  } catch (err) {
    cutoverPoolFailed = true;
    logger.warn({ err }, "cutoverFlags: could not create pool (fail-open)");
    return null;
  }
}

async function loadCutoverFlags(): Promise<Record<string, boolean>> {
  const now = Date.now();
  if (now - cutoverLoadedAt < CUTOVER_TTL_MS) return cutoverCache;
  cutoverLoadedAt = now;
  const p = getCutoverPool();
  if (!p) {
    cutoverCache = {};
    return cutoverCache;
  }
  try {
    const { rows } = await p.query<{ entity_name: string; use_db: boolean }>(
      "SELECT entity_name, use_db FROM entity_cutover_flags"
    );
    const next: Record<string, boolean> = {};
    for (const r of rows) next[r.entity_name] = Boolean(r.use_db);
    cutoverCache = next;
  } catch (err) {
    // migration اجرا نشده یا خطای گذرا — مثل بات، روی Sheets می‌مانیم.
    logger.debug({ err }, "cutoverFlags: read failed (fail-open, staying on Sheets)");
    cutoverCache = {};
  }
  return cutoverCache;
}

export async function isEntityOnPostgres(entity: string): Promise<boolean> {
  const flags = await loadCutoverFlags();
  return flags[entity] === true;
}

/** همه‌ی پرچم‌ها — برای صفحه‌ی سلامت بات (فاز ۲۴). */
export async function allCutoverFlags(): Promise<Record<string, boolean>> {
  return { ...(await loadCutoverFlags()) };
}

/**
 * اگر این entity روی Postgres مهاجرت کرده باشد، ۴۰۹ می‌اندازد. هر روتی که روی
 * یک تب می‌نویسد باید اول این را صدا بزند.
 */
export async function assertSheetsAuthoritative(entity: string): Promise<void> {
  if (await isEntityOnPostgres(entity)) {
    throw new BotConfigError(
      409,
      "این بخش از بات به دیتابیس مهاجرت کرده و دیگر از روی شیت خوانده نمی‌شود؛ فعلاً از اینجا قابل ویرایش نیست.",
      "entity_on_postgres"
    );
  }
}

/** فقط برای تست — کش پرچم‌ها را خالی می‌کند. */
export function resetCutoverCacheForTests(): void {
  cutoverCache = {};
  cutoverLoadedAt = 0;
}
