/**
 * lib/sheetPoolRepair.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * دکمه‌ی «بررسی و تعمیر همه» در صفحه‌ی Sheet Pool.
 *
 * مشکل: بعضی شیت‌ها Access Denied (۴۰۳) یا Not Found (۴۰۴) می‌دهند — یا چون
 * ایمیل سرویس‌اکانت از Editorها حذف شده، یا چون خودِ فایل پاک/منتقل شده. هم
 * شیت‌های آزاد در pool خراب می‌شوند هم شیت‌های بات‌ها؛ در حالت دوم بخش مدیریتِ
 * بات خالی می‌ماند.
 *
 * کار این ماژول:
 *   ۱. همه‌ی شیت‌ها (pool + شیتِ هر بات) را زنده تست می‌کند. فقط ۴۰۳
 *      PERMISSION_DENIED و ۴۰۴ «خراب» حساب می‌شوند؛ هر خطای دیگر (۴۲۹، ۵xx،
 *      قطعی شبکه، نبودِ credentials) «نامشخص» است و **هیچ‌وقت** به‌خاطرش چیزی
 *      حذف یا عوض نمی‌شود. خرابی قبل از اقدام یک بار دیگر تأیید می‌شود.
 *   ۲. شیتِ خرابِ «آزاد» را از pool حذف می‌کند.
 *   ۳. شیتِ خرابِ «اختصاص‌یافته» را با یک شیت سالمِ آزاد جایگزین می‌کند.
 *      دیتای واقعی بات در Postgres است و با `tenant_id = sheetId` کلید خورده؛
 *      پس با عوض‌شدن شیت باید همان ردیف‌ها به tenant_id جدید منتقل شوند وگرنه
 *      بات دیتایش را «گم» می‌کند. این انتقال در یک تراکنش است و هر خطایی
 *      rollback می‌شود (بات دست‌نخورده روی شیت قبلی می‌ماند).
 *   ۴. به صاحبِ بات (اعلان سایت + تلگرام) خبر می‌دهد که درست شد.
 *   ۵. گزارش پایانی: چند تا خراب/سالم در شیت‌های خالی و در بات‌ها.
 *
 * حالت `dry` فقط گزارش می‌دهد و هیچ چیز را تغییر نمی‌دهد.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, botsTable, sheetPoolTable, usersTable } from "@workspace/db";
import type { PoolClient } from "pg";
import { logger } from "./logger.js";
import { diagnoseSheetAccess, ensureAllTenantTabs, renameSpreadsheet } from "./sheets.js";
import type { SheetAccessDiagnosis } from "./sheets.js";
import { syncSheetPoolDelete, syncSheetPoolUpsert, syncTenantUpsert } from "./sheetsSync.js";
import { decryptToken } from "./tokenCrypto.js";
import { createNotification } from "./notify.js";
import { enqueueSheetsExport } from "./sheetsExport.js";
import { getBusinessPool } from "./businessDbPool.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type SheetHealth = "ok" | "broken" | "unknown";
export type RepairMode = "dry" | "apply";

export type RepairItemStatus =
  | "would_repair"
  | "repaired"
  | "no_spare"
  | "failed";

export interface RepairItem {
  botId: string;
  botName: string;
  oldSheetId: string;
  newSheetId: string | null;
  status: RepairItemStatus;
  /** چند ردیف در چند جدولِ Postgres به tenant جدید منتقل شد (یا در dry: منتقل می‌شد). */
  tablesWithData: number;
  rowsMoved: number;
  ownerNotified: boolean;
  reason?: string;
}

export interface RepairReport {
  mode: RepairMode;
  startedAt: string;
  finishedAt: string | null;
  /** شیت‌های خالیِ pool (status = available). */
  spares: { total: number; healthy: number; broken: number; unknown: number; removed: number };
  /** شیتِ بات‌ها (هر بات یک بار شمرده می‌شود). */
  bots: {
    total: number;
    healthy: number;
    broken: number;
    unknown: number;
    repaired: number;
    wouldRepair: number;
    noSpare: number;
    failed: number;
    withoutSheet: number;
  };
  items: RepairItem[];
  notes: string[];
}

export interface RepairProgress {
  phase: "idle" | "probing" | "removing" | "repairing" | "done" | "error";
  done: number;
  total: number;
}

// ─── Pure helpers (unit-tested) ─────────────────────────────────────────────

/**
 * فقط این دو حالت «قطعاً خراب» هستند:
 *   - ۴۰۳ با reason=PERMISSION_DENIED (یا متنِ «does not have permission»)
 *   - ۴۰۴ / NOT_FOUND
 * ۴۰۳ با rateLimitExceeded و ۴۲۹ و ۵xx و خطای شبکه «نامشخص»اند، نه خراب.
 */
export function classifyDiagnosis(d: SheetAccessDiagnosis): SheetHealth {
  if (d.ok) return "ok";
  const status = d.httpStatus;
  const reason = String(d.googleReason ?? "").toUpperCase();
  const msg = String(d.message ?? "").toLowerCase();
  if (status === 404 || reason === "NOT_FOUND" || reason === "NOTFOUND") return "broken";
  if (status === 403) {
    if (reason.includes("RATE") || reason.includes("QUOTA")) return "unknown";
    if (reason === "PERMISSION_DENIED" || reason === "FORBIDDEN" || msg.includes("does not have permission")) {
      return "broken";
    }
  }
  return "unknown";
}

export function emptyReport(mode: RepairMode): RepairReport {
  return {
    mode,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    spares: { total: 0, healthy: 0, broken: 0, unknown: 0, removed: 0 },
    bots: { total: 0, healthy: 0, broken: 0, unknown: 0, repaired: 0, wouldRepair: 0, noSpare: 0, failed: 0, withoutSheet: 0 },
    items: [],
    notes: [],
  };
}

/** متنِ اعلانی که صاحبِ بات می‌گیرد. */
export function ownerMessage(botName: string): { title: string; message: string } {
  return {
    title: `شیتِ بات «${botName}» ترمیم شد`,
    message:
      `دسترسی به گوگل‌شیتِ بات «${botName}» قطع شده بود و پنل مدیریتِ بات خالی نشان می‌داد. ` +
      "یک شیتِ سالم جایگزین شد و اطلاعات بات از دیتابیس به آن منتقل شد. " +
      "نیازی به هیچ کاری از طرف شما نیست؛ اگر چیزی ناقص دیدید به پشتیبانی خبر بدهید.",
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

// ─── Probing ────────────────────────────────────────────────────────────────

async function probeOnce(sheetId: string): Promise<SheetHealth> {
  return classifyDiagnosis(await diagnoseSheetAccess(sheetId));
}

/** تست زنده؛ اگر خراب بود یک بار دیگر تأیید می‌شود تا یک اشتباهِ لحظه‌ای کسی را خراب نکند. */
export async function probeSheet(sheetId: string): Promise<SheetHealth> {
  const first = await probeOnce(sheetId);
  if (first !== "broken") return first;
  await new Promise((r) => setTimeout(r, 1500));
  const second = await probeOnce(sheetId);
  return second === "broken" ? "broken" : "unknown";
}

async function probeMany(
  sheetIds: string[],
  onTick: (done: number, total: number) => void,
): Promise<Map<string, SheetHealth>> {
  const result = new Map<string, SheetHealth>();
  let done = 0;
  await mapLimit(sheetIds, 5, async (id) => {
    let h: SheetHealth;
    try {
      h = await probeSheet(id);
    } catch (err) {
      logger.warn({ err, sheetId: id }, "sheetPoolRepair: probe threw (treated as unknown)");
      h = "unknown";
    }
    result.set(id, h);
    onTick(++done, sheetIds.length);
  });
  return result;
}

// ─── Postgres tenant data (tenant_id === sheetId) ───────────────────────────

/** جدول‌هایی که tenant_id دارند ولی «دیتای بات» نیستند. */
const NON_TENANT_DATA_TABLES = new Set([
  "entity_cutover_flags", // جداگانه جابه‌جا می‌شود (RLS ندارد)
  "registry_tenants",
  "registry_sheet_pool",
  "sheets_import_requests",
  "sheets_export_requests",
]);

function qIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function setTenant(client: PoolClient, tenantId: string): Promise<void> {
  // set_config(..., true) = transaction-local (همان الگوی businessPg.withTenantTx)
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
}

async function listTenantTables(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(
    `SELECT c.table_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.column_name = 'tenant_id'
        AND c.table_schema = current_schema()
        AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name`,
  );
  return rows.map((r) => r.table_name).filter((t) => !NON_TENANT_DATA_TABLES.has(t));
}

export interface TenantDataSummary {
  tables: number;
  rows: number;
}

/** فقط می‌شمارد (برای dry-run). اگر BUSINESS_DATABASE_URL نباشد null. */
export async function countTenantData(tenantId: string): Promise<TenantDataSummary | null> {
  const pool = getBusinessPool();
  if (!pool) return null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await setTenant(client, tenantId);
    let tables = 0;
    let rows = 0;
    for (const t of await listTenantTables(client)) {
      const { rows: r } = await client.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM ${qIdent(t)}`);
      const c = r[0]?.c ?? 0;
      if (c > 0) {
        tables++;
        rows += c;
      }
    }
    const flags = await client.query<{ c: number }>(
      "SELECT COUNT(*)::int AS c FROM entity_cutover_flags WHERE tenant_id = $1",
      [tenantId],
    );
    rows += flags.rows[0]?.c ?? 0;
    await client.query("ROLLBACK");
    return { tables, rows };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection gone */
    }
    logger.warn({ err, tenantId }, "sheetPoolRepair: countTenantData failed");
    return null;
  } finally {
    client.release();
  }
}

/**
 * همه‌ی ردیف‌های tenant قدیمی را به tenant جدید منتقل می‌کند — همه در یک تراکنش.
 *
 * چرا کپی+حذف و نه UPDATE؟ سیاست RLS (`0028_row_level_security.sql`) هم USING و
 * هم WITH CHECK دارد: با app.tenant_id قدیمی نمی‌شود tenant_id را به مقدار جدید
 * آپدیت کرد. پس: خواندن با tenant قدیمی ← درج با tenant جدید ← حذف با قدیمی.
 * (ورودی‌ها FK ندارند، پس ترتیب جدول‌ها مهم نیست.)
 *
 * ایمنی: اگر tenant جدید از قبل هر دیتایی داشته باشد، یا شمارش بعد از درج با
 * قبل نخواند، throw می‌شود و کل تراکنش rollback می‌شود.
 */
export async function moveTenantData(oldId: string, newId: string): Promise<TenantDataSummary> {
  const pool = getBusinessPool();
  if (!pool) throw new Error("BUSINESS_DATABASE_URL تنظیم نشده — انتقال دیتای Postgres ممکن نیست");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let movedTables = 0;
    let movedRows = 0;

    for (const t of await listTenantTables(client)) {
      const tbl = qIdent(t);

      await setTenant(client, oldId);
      const before = (await client.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM ${tbl}`)).rows[0]?.c ?? 0;
      if (before === 0) continue;

      await setTenant(client, newId);
      const existing = (await client.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM ${tbl}`)).rows[0]?.c ?? 0;
      if (existing > 0) {
        throw new Error(`شیت جدید از قبل در جدول ${t} دیتا دارد (${existing} ردیف) — انتقال لغو شد`);
      }

      await setTenant(client, oldId);
      const data = (
        await client.query<{ data: Record<string, unknown>[] }>(
          `SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS data FROM ${tbl} x`,
        )
      ).rows[0]!.data;

      await setTenant(client, newId);
      for (let i = 0; i < data.length; i += 500) {
        const chunk = data.slice(i, i + 500).map((row) => ({ ...row, tenant_id: newId }));
        await client.query(
          `INSERT INTO ${tbl} SELECT * FROM jsonb_populate_recordset(NULL::${tbl}, $1::jsonb)`,
          [JSON.stringify(chunk)],
        );
      }
      const after = (await client.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM ${tbl}`)).rows[0]?.c ?? 0;
      if (after !== before) {
        throw new Error(`جدول ${t}: ${before} ردیف خوانده شد ولی ${after} ردیف درج شد — انتقال لغو شد`);
      }

      await setTenant(client, oldId);
      await client.query(`DELETE FROM ${tbl}`);

      movedTables++;
      movedRows += before;
    }

    // فلگ‌های cutover (که می‌گویند هر entity از Postgres خوانده شود) RLS ندارند.
    const newFlags = (
      await client.query<{ c: number }>("SELECT COUNT(*)::int AS c FROM entity_cutover_flags WHERE tenant_id = $1", [newId])
    ).rows[0]?.c ?? 0;
    if (newFlags === 0) {
      const upd = await client.query("UPDATE entity_cutover_flags SET tenant_id = $2 WHERE tenant_id = $1", [oldId, newId]);
      movedRows += upd.rowCount ?? 0;
    }

    await client.query("COMMIT");
    return { tables: movedTables, rows: movedRows };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection gone */
    }
    throw err;
  } finally {
    client.release();
  }
}

// ─── Spare-sheet claiming (same atomic pattern as routes/bots.ts) ───────────

async function claimFreeSheet(botId: string) {
  const picked = db
    .select({ id: sheetPoolTable.id })
    .from(sheetPoolTable)
    .where(eq(sheetPoolTable.status, "available"))
    .limit(1)
    .for("update", { skipLocked: true });

  const [claimed] = await db
    .update(sheetPoolTable)
    .set({ status: "assigned", assignedBotId: botId })
    .where(inArray(sheetPoolTable.id, picked))
    .returning();
  return claimed ?? null;
}

async function releaseClaim(poolRowId: string): Promise<void> {
  await db.update(sheetPoolTable).set({ status: "available", assignedBotId: null }).where(eq(sheetPoolTable.id, poolRowId));
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function runSheetPoolRepair(
  mode: RepairMode,
  requestedBy: string,
  onProgress: (p: RepairProgress) => void,
): Promise<RepairReport> {
  const report = emptyReport(mode);

  const poolRows = await db.select().from(sheetPoolTable);
  const allBots = await db.select().from(botsTable);
  const bots = allBots.filter((b) => !!b.sheetId);
  report.bots.withoutSheet = allBots.length - bots.length;

  // ۱) تست همه‌ی شیت‌های یکتا
  const uniqueIds = [...new Set([...poolRows.map((r) => r.sheetId), ...bots.map((b) => b.sheetId!)])];
  onProgress({ phase: "probing", done: 0, total: uniqueIds.length });
  const health = await probeMany(uniqueIds, (done, total) => onProgress({ phase: "probing", done, total }));

  // اگر «همه» نامشخص بودند (مثلاً credentials تنظیم نیست) هیچ اقدامی ایمن نیست.
  const anyOk = [...health.values()].some((h) => h === "ok");
  if (uniqueIds.length > 0 && !anyOk && [...health.values()].every((h) => h === "unknown")) {
    report.notes.push(
      "هیچ شیتی قابل تست نبود (احتمالاً GOOGLE_CREDENTIALS_JSON تنظیم نیست یا گوگل در دسترس نیست). هیچ تغییری داده نشد.",
    );
    report.finishedAt = new Date().toISOString();
    return report;
  }

  const botSheetIds = new Set(bots.map((b) => b.sheetId!));

  // ۲) شیت‌های خالی (available)
  const availableRows = poolRows.filter((r) => r.status === "available");
  report.spares.total = availableRows.length;
  const brokenSpares = availableRows.filter((r) => health.get(r.sheetId) === "broken" && !botSheetIds.has(r.sheetId));
  for (const r of availableRows) {
    const h = health.get(r.sheetId);
    if (h === "ok") report.spares.healthy++;
    else if (h === "broken") report.spares.broken++;
    else report.spares.unknown++;
  }

  // ۳) بات‌ها (هر بات یک بار)
  report.bots.total = bots.length;
  const brokenBots = [];
  for (const b of bots) {
    const h = health.get(b.sheetId!);
    if (h === "ok") report.bots.healthy++;
    else if (h === "broken") {
      report.bots.broken++;
      brokenBots.push(b);
    } else report.bots.unknown++;
  }

  // ۴) حذفِ شیت‌های خراب از بین «خالی»ها
  onProgress({ phase: "removing", done: 0, total: brokenSpares.length });
  if (mode === "apply") {
    for (const r of brokenSpares) {
      try {
        await db.delete(sheetPoolTable).where(and(eq(sheetPoolTable.id, r.id), eq(sheetPoolTable.status, "available")));
        syncSheetPoolDelete(r.sheetId);
        report.spares.removed++;
      } catch (err) {
        logger.error({ err, sheetId: r.sheetId }, "sheetPoolRepair: failed removing broken spare");
        report.notes.push(`حذف شیتِ خراب ${r.sheetId.slice(0, 8)}… از pool خطا داد`);
      }
      onProgress({ phase: "removing", done: report.spares.removed, total: brokenSpares.length });
    }
  }

  // ۵) تعمیرِ بات‌ها
  onProgress({ phase: "repairing", done: 0, total: brokenBots.length });
  let healthySparesLeft = availableRows.filter((r) => health.get(r.sheetId) === "ok" && !botSheetIds.has(r.sheetId)).length;
  let processed = 0;

  for (const bot of brokenBots) {
    const oldSheetId = bot.sheetId!;
    const item: RepairItem = {
      botId: bot.id,
      botName: bot.name,
      oldSheetId,
      newSheetId: null,
      status: "failed",
      tablesWithData: 0,
      rowsMoved: 0,
      ownerNotified: false,
    };

    try {
      if (mode === "dry") {
        const summary = await countTenantData(oldSheetId);
        item.tablesWithData = summary?.tables ?? 0;
        item.rowsMoved = summary?.rows ?? 0;
        if (healthySparesLeft > 0) {
          healthySparesLeft--;
          item.status = "would_repair";
        } else {
          item.status = "no_spare";
          item.reason = "شیت سالمِ آزاد در pool نمانده — شیت جدید اضافه کن";
        }
      } else {
        await repairOneBot(bot, item, requestedBy);
      }
    } catch (err) {
      logger.error({ err, botId: bot.id }, "sheetPoolRepair: bot repair failed");
      item.status = "failed";
      item.reason = (err as Error).message;
    }

    if (item.status === "repaired") report.bots.repaired++;
    else if (item.status === "would_repair") report.bots.wouldRepair++;
    else if (item.status === "no_spare") report.bots.noSpare++;
    else if (item.status === "failed") report.bots.failed++;
    report.items.push(item);
    onProgress({ phase: "repairing", done: ++processed, total: brokenBots.length });
  }

  if (mode === "dry") {
    // در dry «would_repair» جدا شمرده نمی‌شود؛ از items خوانده می‌شود.
    report.notes.push("این فقط پیش‌نمایش بود؛ هیچ چیز تغییر نکرد.");
  }
  if (report.bots.unknown > 0 || report.spares.unknown > 0) {
    report.notes.push("بعضی شیت‌ها به‌خاطر خطای موقتِ گوگل (نه Access Denied) قابل تست نبودند و دست‌نخورده ماندند.");
  }
  report.finishedAt = new Date().toISOString();
  return report;
}

async function repairOneBot(
  bot: typeof botsTable.$inferSelect,
  item: RepairItem,
  requestedBy: string,
): Promise<void> {
  const oldSheetId = bot.sheetId!;

  // شیت سالمِ آزاد بگیر (اتمیک). هر شیتِ خرابی که در راه پیدا شد از pool حذف می‌شود.
  let spare: typeof sheetPoolTable.$inferSelect | null = null;
  for (let attempt = 0; attempt < 50; attempt++) {
    const claimed = await claimFreeSheet(bot.id);
    if (!claimed) break;
    const h = await probeSheet(claimed.sheetId);
    if (h === "ok") {
      spare = claimed;
      break;
    }
    if (h === "broken") {
      await db.delete(sheetPoolTable).where(eq(sheetPoolTable.id, claimed.id));
      syncSheetPoolDelete(claimed.sheetId);
      continue;
    }
    // نامشخص: برگردانش و متوقف شو (حدس نمی‌زنیم)
    await releaseClaim(claimed.id);
    item.status = "no_spare";
    item.reason = "شیت‌های آزاد به‌خاطر خطای موقتِ گوگل تست نشدند؛ بعداً دوباره امتحان کن";
    return;
  }
  if (!spare) {
    item.status = "no_spare";
    item.reason = "شیت سالمِ آزاد در pool نمانده — شیت جدید اضافه کن";
    return;
  }

  const newSheetId = spare.sheetId;
  item.newSheetId = newSheetId;

  try {
    try {
      await ensureAllTenantTabs(newSheetId);
    } catch (err) {
      logger.warn({ err, newSheetId }, "sheetPoolRepair: ensureAllTenantTabs failed (non-fatal)");
    }

    // دیتای Postgres: tenant_id قدیمی → جدید (اتمیک؛ خطا = rollback)
    let moved: TenantDataSummary | null = null;
    if (getBusinessPool()) {
      moved = await moveTenantData(oldSheetId, newSheetId);
      item.tablesWithData = moved.tables;
      item.rowsMoved = moved.rows;
    }

    try {
      await db.update(botsTable).set({ sheetId: newSheetId }).where(eq(botsTable.id, bot.id));
    } catch (err) {
      // دیتا جابه‌جا شده ولی بات هنوز به شیت قدیمی اشاره می‌کند → برگردان.
      if (moved && moved.rows > 0) {
        try {
          await moveTenantData(newSheetId, oldSheetId);
        } catch (undoErr) {
          logger.error({ undoErr, oldSheetId, newSheetId }, "sheetPoolRepair: UNDO of tenant data move failed");
        }
      }
      throw err;
    }
  } catch (err) {
    // شیتِ جدید را آزاد برگردان؛ بات روی شیت قبلی می‌ماند.
    await releaseClaim(spare.id).catch(() => {});
    item.status = "failed";
    item.newSheetId = null;
    item.reason = (err as Error).message;
    return;
  }

  // ردیفِ pool قدیمی را فقط اگر دیگر هیچ باتی به آن اشاره نمی‌کند حذف کن.
  const stillUsed = await db
    .select({ id: botsTable.id })
    .from(botsTable)
    .where(eq(botsTable.sheetId, oldSheetId))
    .limit(1);
  if (stillUsed.length === 0) {
    await db.delete(sheetPoolTable).where(eq(sheetPoolTable.sheetId, oldSheetId));
    syncSheetPoolDelete(oldSheetId);
  }

  // رجیستریِ tenant + اسمِ شیت (best-effort، مثل روتِ replace)
  try {
    await renameSpreadsheet(newSheetId, `irforge-${bot.name.trim().replace(/\s+/g, "-")}`);
  } catch (err) {
    logger.warn({ err, newSheetId }, "sheetPoolRepair: title sync failed (non-fatal)");
  }
  try {
    const [owner] = await db
      .select({ telegramId: usersTable.telegramId })
      .from(usersTable)
      .where(eq(usersTable.id, bot.userId))
      .limit(1);
    syncTenantUpsert({
      bot_token: decryptToken(bot.token),
      bot_name: bot.name,
      bot_username: bot.username,
      owner_user_id: bot.userId,
      owner_telegram_id: owner?.telegramId ?? null,
      sheet_id: newSheetId,
      admin_password: bot.adminCode ?? "",
      status: bot.status,
      created_at: bot.createdAt,
    });
    syncSheetPoolUpsert({
      sheet_id: newSheetId,
      assigned_to: bot.id,
      used_by: decryptToken(bot.token),
      status: "assigned",
    });
  } catch (err) {
    logger.warn({ err, botId: bot.id }, "sheetPoolRepair: registry sync failed (non-fatal)");
  }

  // دیتای Postgres را در شیتِ جدید هم بنویس (صفِ export موجودِ سایت؛ best-effort)
  if (item.rowsMoved > 0) {
    try {
      await enqueueSheetsExport(newSheetId, requestedBy, null);
    } catch (err) {
      logger.warn({ err, newSheetId }, "sheetPoolRepair: enqueueSheetsExport failed (non-fatal)");
    }
  }

  // اطلاع به صاحب بات
  try {
    const { title, message } = ownerMessage(bot.name);
    await createNotification({
      userId: bot.userId,
      botId: bot.id,
      type: "sheet_repair_success",
      severity: "info",
      title,
      message,
      dedupeKey: `sheet-repair:${bot.id}:${newSheetId}`,
    });
    item.ownerNotified = true;
  } catch (err) {
    logger.warn({ err, botId: bot.id }, "sheetPoolRepair: owner notification failed (non-fatal)");
  }

  item.status = "repaired";
}
