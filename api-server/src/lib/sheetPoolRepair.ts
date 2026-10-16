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
 *   ۲. هر ردیفِ خرابِ pool که **هیچ باتِ زنده‌ای** به آن وصل نیست (چه «آزاد»، چه
 *      «اختصاص‌یافته‌ی بی‌صاحب») کامل از pool حذف می‌شود.
 *      شیتِ سالم ولی بی‌صاحب (دیتا دارد، به هیچ باتی تعلق ندارد) کامل پاک می‌شود
 *      (شیت + دیتای Postgres) و به «آزاد» برمی‌گردد.
 *   ۳. شیتِ خرابِ بات را با یکی از همین شیت‌های تمیز جایگزین می‌کند.
 *      دیتای واقعی بات در Postgres است و با `tenant_id = sheetId` کلید خورده؛
 *      پس با عوض‌شدن شیت باید همان ردیف‌ها به tenant_id جدید منتقل شوند وگرنه
 *      بات دیتایش را «گم» می‌کند. این انتقال در یک تراکنش است و هر خطایی
 *      rollback می‌شود (بات دست‌نخورده روی شیت قبلی می‌ماند).
 *   ۴. به صاحبِ بات (اعلان سایت + تلگرام) خبر می‌دهد که درست شد.
 *   ۵. گزارش پایانی: چند تا خراب/سالم در شیت‌های خالی و در بات‌ها.
 *
 * حالت `dry` فقط گزارش می‌دهد و هیچ چیز را تغییر نمی‌دهد.
 */
import { and, eq, inArray, notExists, notInArray } from "drizzle-orm";
import { db, botsTable, sheetPoolTable, usersTable } from "@workspace/db";
import type { PoolClient } from "pg";
import { logger } from "./logger.js";
import { diagnoseSheetAccess, ensureAllTenantTabs, renameSpreadsheet, resetSpreadsheet } from "./sheets.js";
import type { SheetAccessDiagnosis } from "./sheets.js";
import { syncSheetPoolDelete, syncSheetPoolUpsert, syncTenantUpsert } from "./sheetsSync.js";
import { decryptToken } from "./tokenCrypto.js";
import { createNotification } from "./notify.js";
import { enqueueSheetsExport } from "./sheetsExport.js";
import { getBusinessPool } from "./businessDbPool.js";
import { markSheetTitleFreed, purgeTenantPostgresData } from "./botPurge.js";

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
  /** ترکیب pool: چند ردیف، چند تا به باتِ زنده وصل است، چند تا آزاد، چند تا بی‌صاحب. */
  pool: { total: number; inUse: number; free: number; orphans: number };
  /** شیت‌های آزادِ pool (status = available و بدون باتِ زنده). */
  spares: { total: number; healthy: number; broken: number; unknown: number; removed: number };
  /** شیت‌های «اختصاص‌یافته» که هیچ باتِ زنده‌ای ندارند (بی‌صاحب)؛ ممکن است دیتا داشته باشند. */
  orphans: { total: number; healthy: number; broken: number; unknown: number; wiped: number; deleted: number; rowsPurged: number };
  /** شیت‌هایی که تست نامشخص شد (برای اینکه ادمین ببیند چرا دست نخوردند). */
  unknownSheets: { sheetId: string; httpStatus?: number; reason?: string }[];
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
  phase: "idle" | "probing" | "removing" | "wiping" | "repairing" | "done" | "error";
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
  // فایلی که اسپردشیتِ بومیِ گوگل نیست (مثلاً xlsx آپلودی): API می‌گوید
  // «This operation is not supported for this document» — برای بات‌ها بلااستفاده است.
  if (status === 400 && (reason === "FAILED_PRECONDITION" || msg.includes("not supported for this document"))) {
    return "broken";
  }
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
    pool: { total: 0, inUse: 0, free: 0, orphans: 0 },
    spares: { total: 0, healthy: 0, broken: 0, unknown: 0, removed: 0 },
    orphans: { total: 0, healthy: 0, broken: 0, unknown: 0, wiped: 0, deleted: 0, rowsPurged: 0 },
    unknownSheets: [],
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

export interface ProbeResult {
  health: SheetHealth;
  diag: SheetAccessDiagnosis | null;
}

async function probeOnce(sheetId: string): Promise<ProbeResult> {
  const diag = await diagnoseSheetAccess(sheetId);
  return { health: classifyDiagnosis(diag), diag };
}

/** تست زنده؛ اگر خراب بود یک بار دیگر تأیید می‌شود تا یک اشتباهِ لحظه‌ای کسی را خراب نکند. */
export async function probeSheetDetailed(sheetId: string): Promise<ProbeResult> {
  const first = await probeOnce(sheetId);
  if (first.health !== "broken") return first;
  await new Promise((r) => setTimeout(r, 1500));
  const second = await probeOnce(sheetId);
  return second.health === "broken" ? second : { health: "unknown", diag: second.diag };
}

export async function probeSheet(sheetId: string): Promise<SheetHealth> {
  return (await probeSheetDetailed(sheetId)).health;
}

async function probeMany(
  sheetIds: string[],
  onTick: (done: number, total: number) => void,
): Promise<Map<string, ProbeResult>> {
  const result = new Map<string, ProbeResult>();
  let done = 0;
  await mapLimit(sheetIds, 5, async (id) => {
    let r: ProbeResult;
    try {
      r = await probeSheetDetailed(id);
    } catch (err) {
      logger.warn({ err, sheetId: id }, "sheetPoolRepair: probe threw (treated as unknown)");
      r = { health: "unknown", diag: null };
    }
    result.set(id, r);
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

/**
 * یک شیتِ «آزاد» را اتمیک برمی‌دارد. برخلاف claimFreeSheet در routes/bots.ts،
 * ردیفی که یک باتِ زنده هنوز به آن اشاره می‌کند (باگِ قدیمیِ sheetId مشترک)
 * و ردیف‌هایی که همین اجرا ردشان کرده انتخاب نمی‌شوند — چون شیتِ انتخاب‌شده
 * پاک‌سازی می‌شود و نباید دیتای یک باتِ زنده را بردارد.
 */
async function claimSpare(botId: string, skipPoolIds: string[]) {
  const conditions = [
    eq(sheetPoolTable.status, "available"),
    notExists(db.select({ x: botsTable.id }).from(botsTable).where(eq(botsTable.sheetId, sheetPoolTable.sheetId))),
  ];
  if (skipPoolIds.length > 0) conditions.push(notInArray(sheetPoolTable.id, skipPoolIds));

  const picked = db
    .select({ id: sheetPoolTable.id })
    .from(sheetPoolTable)
    .where(and(...conditions))
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

// ─── Wiping a sheet that belongs to nobody ──────────────────────────────────

/**
 * شیتی که به هیچ باتی تعلق ندارد را کامل پاک می‌کند: ۱) دیتای Postgresِ آن
 * tenant (و فلگ‌های cutover)، ۲) محتوای خودِ گوگل‌شیت (ریست به Sheet1 + تب‌بندی
 * کامل). اگر هر مرحله خطا بدهد throw می‌شود و شیت «تمیز» حساب نمی‌شود.
 * @returns تعداد ردیف‌های Postgres که پاک شد.
 */
export async function wipeUnownedSheet(sheetId: string): Promise<number> {
  let purged = 0;
  if (getBusinessPool()) {
    const before = await countTenantData(sheetId);
    if (before === null) throw new Error("شمارشِ دیتای Postgres این شیت ممکن نشد");
    if (before.rows > 0) {
      await purgeTenantPostgresData(sheetId);
      const after = await countTenantData(sheetId);
      if (after === null || after.rows > 0) {
        throw new Error(`پاک‌کردنِ دیتای Postgres کامل نشد (${after?.rows ?? "؟"} ردیف مانده)`);
      }
      purged = before.rows;
    }
  }
  await resetSpreadsheet(sheetId);
  return purged;
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

  const botSheetIds = new Set(bots.map((b) => b.sheetId!));
  const liveBotIds = new Set(allBots.map((b) => b.id));

  // دسته‌بندی ردیف‌های pool:
  //   inUse   : باتی با این sheetId هست، یا باتِ زنده‌ای رزروش کرده (محافظه‌کارانه، دست نمی‌زنیم)
  //   free    : available و بدون بات
  //   orphan  : assigned ولی نه باتی به آن وصل است نه باتِ زنده‌ای رزروش کرده
  const inUse = poolRows.filter(
    (r) => botSheetIds.has(r.sheetId) || (r.status !== "available" && r.assignedBotId && liveBotIds.has(r.assignedBotId)),
  );
  const inUseIds = new Set(inUse.map((r) => r.id));
  const free = poolRows.filter((r) => !inUseIds.has(r.id) && r.status === "available");
  const orphans = poolRows.filter((r) => !inUseIds.has(r.id) && r.status !== "available");
  report.pool = { total: poolRows.length, inUse: inUse.length, free: free.length, orphans: orphans.length };

  // ۱) تست همه‌ی شیت‌های یکتا
  const uniqueIds = [...new Set([...poolRows.map((r) => r.sheetId), ...bots.map((b) => b.sheetId!)])];
  onProgress({ phase: "probing", done: 0, total: uniqueIds.length });
  const probes = await probeMany(uniqueIds, (done, total) => onProgress({ phase: "probing", done, total }));
  const health = (id: string): SheetHealth => probes.get(id)?.health ?? "unknown";

  // اگر «همه» نامشخص بودند (مثلاً credentials تنظیم نیست) هیچ اقدامی ایمن نیست.
  if (uniqueIds.length > 0 && uniqueIds.every((id) => health(id) === "unknown")) {
    const first = probes.values().next().value?.diag;
    report.notes.push(
      "هیچ شیتی قابل تست نبود (احتمالاً GOOGLE_CREDENTIALS_JSON تنظیم نیست یا گوگل در دسترس نیست). هیچ تغییری داده نشد." +
        (first?.message ? ` — ${String(first.message).slice(0, 160)}` : ""),
    );
    report.finishedAt = new Date().toISOString();
    return report;
  }

  for (const id of uniqueIds) {
    if (health(id) === "unknown") {
      const diag = probes.get(id)?.diag;
      if (report.unknownSheets.length < 15) {
        report.unknownSheets.push({
          sheetId: id,
          httpStatus: diag?.httpStatus,
          reason: String(diag?.googleReason ?? diag?.message ?? "").slice(0, 120) || undefined,
        });
      }
    }
  }

  // آمار شیت‌های آزاد و بی‌صاحب
  report.spares.total = free.length;
  for (const r of free) {
    const h = health(r.sheetId);
    if (h === "ok") report.spares.healthy++;
    else if (h === "broken") report.spares.broken++;
    else report.spares.unknown++;
  }
  report.orphans.total = orphans.length;
  for (const r of orphans) {
    const h = health(r.sheetId);
    if (h === "ok") report.orphans.healthy++;
    else if (h === "broken") report.orphans.broken++;
    else report.orphans.unknown++;
  }

  // آمار بات‌ها (هر بات یک بار)
  report.bots.total = bots.length;
  const brokenBots: typeof bots = [];
  for (const b of bots) {
    const h = health(b.sheetId!);
    if (h === "ok") report.bots.healthy++;
    else if (h === "broken") {
      report.bots.broken++;
      brokenBots.push(b);
    } else report.bots.unknown++;
  }

  // ۲) حذفِ کاملِ ردیف‌های خرابی که هیچ باتی ندارند (آزاد یا بی‌صاحب)
  const brokenUnused = [...free, ...orphans].filter((r) => health(r.sheetId) === "broken");
  onProgress({ phase: "removing", done: 0, total: brokenUnused.length });
  if (mode === "apply") {
    let done = 0;
    for (const r of brokenUnused) {
      try {
        // دوباره مطمئن شو باتی در این فاصله به آن وصل نشده
        const [bound] = await db.select({ id: botsTable.id }).from(botsTable).where(eq(botsTable.sheetId, r.sheetId)).limit(1);
        if (bound) continue;
        // پاکسازی دیتای Postgres این tenant هم (اگر مانده باشد) — خطایش مانع حذف نیست
        try {
          await purgeTenantPostgresData(r.sheetId);
        } catch (err) {
          logger.warn({ err, sheetId: r.sheetId }, "sheetPoolRepair: purge of broken unused sheet's Postgres data failed (non-fatal)");
        }
        await db.delete(sheetPoolTable).where(eq(sheetPoolTable.id, r.id));
        syncSheetPoolDelete(r.sheetId);
        if (r.status === "available") report.spares.removed++;
        else report.orphans.deleted++;
      } catch (err) {
        logger.error({ err, sheetId: r.sheetId }, "sheetPoolRepair: failed removing broken unused sheet");
        report.notes.push(`حذف شیتِ خراب ${r.sheetId.slice(0, 8)}… از pool خطا داد: ${(err as Error).message}`);
      }
      onProgress({ phase: "removing", done: ++done, total: brokenUnused.length });
    }
  }

  // ۳) شیت‌های سالم ولی بی‌صاحب: کامل پاک و به «آزاد» برگردانده می‌شوند
  const healthyOrphans = orphans.filter((r) => health(r.sheetId) === "ok");
  if (mode === "apply") {
    onProgress({ phase: "wiping", done: 0, total: healthyOrphans.length });
    let done = 0;
    for (const r of healthyOrphans) {
      try {
        const [bound] = await db.select({ id: botsTable.id }).from(botsTable).where(eq(botsTable.sheetId, r.sheetId)).limit(1);
        if (bound) continue;
        report.orphans.rowsPurged += await wipeUnownedSheet(r.sheetId);
        await releaseClaim(r.id);
        syncSheetPoolUpsert({ sheet_id: r.sheetId, assigned_to: null, status: "available" });
        await markSheetTitleFreed(r.sheetId);
        report.orphans.wiped++;
      } catch (err) {
        logger.error({ err, sheetId: r.sheetId }, "sheetPoolRepair: wiping unowned sheet failed");
        report.notes.push(`پاک‌کردنِ شیتِ بی‌صاحب ${r.sheetId.slice(0, 8)}… خطا داد: ${(err as Error).message}`);
      }
      onProgress({ phase: "wiping", done: ++done, total: healthyOrphans.length });
    }
  } else {
    // dry: فقط بشمار چقدر دیتا پاک می‌شد
    for (const r of healthyOrphans) {
      const c = await countTenantData(r.sheetId);
      report.orphans.rowsPurged += c?.rows ?? 0;
    }
  }

  // ۴) تعمیرِ بات‌ها با شیت‌های تمیز
  onProgress({ phase: "repairing", done: 0, total: brokenBots.length });
  let sparesLeft =
    free.filter((r) => health(r.sheetId) === "ok").length + healthyOrphans.length; // dry: هر دو دسته پس از پاک‌سازی آماده‌اند
  let processed = 0;
  const skipPoolIds: string[] = [];

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
        if (sparesLeft > 0) {
          sparesLeft--;
          item.status = "would_repair";
        } else {
          item.status = "no_spare";
          item.reason = "شیت سالمِ آزاد در pool نمانده — شیت جدید اضافه کن";
        }
      } else {
        await repairOneBot(bot, item, requestedBy, skipPoolIds);
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

  if (mode === "dry") report.notes.push("این فقط پیش‌نمایش بود؛ هیچ چیز تغییر نکرد.");
  if (report.unknownSheets.length > 0) {
    report.notes.push("بعضی شیت‌ها به‌خاطر خطای موقتِ گوگل (نه Access Denied) قابل تست نبودند و دست‌نخورده ماندند؛ دلیلشان پایین است.");
  }
  report.finishedAt = new Date().toISOString();
  return report;
}

async function repairOneBot(
  bot: typeof botsTable.$inferSelect,
  item: RepairItem,
  requestedBy: string,
  skipPoolIds: string[],
): Promise<void> {
  const oldSheetId = bot.sheetId!;

  // یک شیتِ سالمِ آزاد بگیر (اتمیک)، تمیزش کن، بعد استفاده. شیتِ خرابی که در راه
  // پیدا شد از pool حذف می‌شود.
  let spare: typeof sheetPoolTable.$inferSelect | null = null;
  for (let attempt = 0; attempt < 50; attempt++) {
    const claimed = await claimSpare(bot.id, skipPoolIds);
    if (!claimed) break;
    const h = await probeSheet(claimed.sheetId);
    if (h === "broken") {
      await db.delete(sheetPoolTable).where(eq(sheetPoolTable.id, claimed.id));
      syncSheetPoolDelete(claimed.sheetId);
      continue;
    }
    if (h === "unknown") {
      await releaseClaim(claimed.id);
      skipPoolIds.push(claimed.id);
      continue;
    }
    // سالم: مطمئن شو کاملاً خالی است (ممکن است از باتِ قدیمی دیتا داشته باشد)
    try {
      await wipeUnownedSheet(claimed.sheetId);
    } catch (err) {
      logger.warn({ err, sheetId: claimed.sheetId }, "sheetPoolRepair: could not clean spare; skipping it");
      await releaseClaim(claimed.id);
      skipPoolIds.push(claimed.id);
      continue;
    }
    spare = claimed;
    break;
  }
  if (!spare) {
    item.status = "no_spare";
    item.reason = "شیت سالمِ آزاد در pool نمانده — شیت جدید اضافه کن";
    return;
  }

  const newSheetId = spare.sheetId;
  item.newSheetId = newSheetId;

  try {
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

  // ردیفِ pool قدیمی (شیتِ خراب) را فقط اگر دیگر هیچ باتی به آن اشاره نمی‌کند حذف کن.
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
