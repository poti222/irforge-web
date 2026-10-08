/**
 * lib/botPurge.ts — حذفِ کاملِ یک بات (دستی، انقضایِ خودکار، یا فراخوانیِ داخلیِ mainbot).
 * ─────────────────────────────────────────────────────────────────────────────
 * قبلاً داخلِ routes/bots.ts بود؛ برای اینکه جاروی انقضا (lib/botLifecycle.ts) هم بتواند همان منطقِ واحد را صدا بزند
 * (بدونِ import چرخه‌ای از routes) به lib منتقل شد — بدونِ هیچ تغییرِ رفتاری.
 */
import { db, botsTable, commandsTable, installedPluginsTable, sheetPoolTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { decryptToken } from "./tokenCrypto";
import { syncBotDelete, syncSheetPoolUpsert, syncTenantDeleteAwait, syncDeletionQueueAdd } from "./sheetsSync";
import { renameSpreadsheet, resetSpreadsheet } from "./sheets";
import { getBusinessPool } from "./businessDbPool.js";
import { invalidateCutoverCache } from "./botConfig.js";

/**
 * وقتی شیتی از یک بات آزاد می‌شه (چه با حذف بات، چه با release دستی توسط
 * سوپرادمین)، عنوانش رو "~" می‌کنیم تا مشخص باشه دیگه هیچ بات فعالی
 * ازش استفاده نمی‌کنه. Best-effort و non-fatal، مثل syncSheetTitle.
 */
export async function markSheetTitleFreed(sheetId: string | null | undefined) {
  if (!sheetId) return;
  try {
    await renameSpreadsheet(sheetId, "~");
  } catch (err) {
    logger.warn({ err, sheetId }, "sheet title freed-rename failed (non-fatal)");
  }
}

/**
 * داده‌ی بات‌هایی که به Postgres مهاجرت کرده‌اند (`entity_cutover_flags`) در
 * جدول‌های `tenant_id = spreadsheet_id` است، نه در گوگل‌شیت؛ پس ریست‌کردنِ شیت
 * به‌تنهایی چیزی از آن‌ها پاک نمی‌کرد و (۱) داده‌ی بات حذف‌شده می‌ماند و
 * (۲) پرچم‌های cutover باعث می‌شد باتِ بعدیِ همین شیت به داده‌ی قبلی وصل شود.
 * همه‌ی جدول‌هایی که ستون `tenant_id` دارند از information_schema خوانده و
 * در یک تراکنش (با ست‌کردن `app.tenant_id` برای RLS) پاک می‌شوند.
 * Best-effort: خطا فقط لاگ می‌شود.
 */
export async function purgeTenantPostgresData(tenantId: string): Promise<number> {
  const pool = getBusinessPool();
  if (!pool || !tenantId) return 0;
  const client = await pool.connect();
  let deleted = 0;
  try {
    const { rows } = await client.query<{ table_name: string }>(
      `SELECT c.table_name FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema = current_schema() AND c.column_name = 'tenant_id'`
    );
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    for (const { table_name } of rows) {
      const ident = `"${table_name.replace(/"/g, '""')}"`;
      const res = await client.query(`DELETE FROM ${ident} WHERE tenant_id = $1`, [tenantId]);
      deleted += res.rowCount ?? 0;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    logger.error({ err, tenantId }, "purgeTenantPostgresData failed (non-fatal) — bot's Postgres rows may remain");
    return 0;
  } finally {
    client.release();
    invalidateCutoverCache();
  }
  return deleted;
}

// ─── Shared full-purge logic (manual delete + expiry-triggered internal purge) ─
// See docs/DELETION_POLICY.md. Deletes the bot's site Postgres rows, then
// fires the registry/sheet-pool/deletion-queue syncs — the two previously
// written-but-never-called `syncTenantDelete`/`syncSheetPoolUpsert` functions
// are wired in here, plus the new `syncDeletionQueueAdd`.
export async function purgeBotFully(
  bot: { id: string; token: string; sheetId: string | null },
  requestedBy: "manual" | "expiry"
) {
  await db.delete(commandsTable).where(eq(commandsTable.botId, bot.id));
  await db.delete(installedPluginsTable).where(eq(installedPluginsTable.botId, bot.id));
  await db.delete(botsTable).where(eq(botsTable.id, bot.id));

  syncBotDelete(bot.id);

  const plainToken = decryptToken(bot.token);
  // Live incident 2026-09-21: this used to be the fire-and-forget
  // syncTenantDelete(), so the route could (and did) respond 204 before the
  // registry row was actually gone. The frontend's own onSuccess handler
  // invalidates the bots-list query immediately, and reconcileBotsFromRegistry()
  // (run on every GET /bots) can't tell "deleted on purpose, sync just hasn't
  // landed yet" apart from "never registered" -- it re-imported the tenant
  // as a brand-new bot row (zero commands/users) the moment that refetch beat
  // the background write. Awaiting it here closes that race. A failure here
  // is logged loudly but doesn't fail the whole delete -- the bot's actual
  // data (commands/plugins/Postgres row, and the sheet reset below) is
  // already irreversibly gone by this point either way.
  try {
    await syncTenantDeleteAwait(plainToken);
  } catch (err) {
    logger.error(
      { err, botId: bot.id },
      "registry tenant-delete failed during purge -- the bot's Postgres row is gone, but a stale registry " +
        "row may still resurrect it as an empty duplicate on the next GET /bots reconcile pass"
    );
  }

  if (bot.sheetId) {
    // BUG FIX: pre-existing sheet-pool race conditions (see claimFreeSheet
    // above) left some sheetIds silently shared by more than one bot row —
    // sometimes across different users. Wiping/releasing the sheet here used
    // to assume this bot was its only user; if another bot row still points
    // at the same sheetId, that would permanently destroy that OTHER bot's
    // live data and hand its sheet out to a third, unrelated tenant. Check
    // first, and only touch the real Google Sheet / pool row when this was
    // truly the sole owner.
    const [stillInUse] = await db
      .select({ id: botsTable.id })
      .from(botsTable)
      .where(eq(botsTable.sheetId, bot.sheetId))
      .limit(1);

    if (stillInUse) {
      logger.error(
        { sheetId: bot.sheetId, deletedBotId: bot.id, otherBotId: stillInUse.id },
        "sheetId is still referenced by another bot row after purge — skipping resetSpreadsheet/pool-release " +
          "to avoid destroying that bot's live data (pre-existing sheet-pool collision, needs manual review)"
      );
    } else {
      // قبلاً فقط رجیستری/وضعیت Postgres آزاد می‌شد ولی خودِ گوگل‌شیت پاک
      // نمی‌شد، پس بات بعدی که این شیت بهش assign می‌شد تب‌ها و دیتای بات
      // قبلی رو می‌دید. حالا قبل از available کردن، خودِ شیت کاملاً ریست
      // می‌شه (انگار تازه ساخته شده).
      await purgeTenantPostgresData(bot.sheetId);

      try {
        await resetSpreadsheet(bot.sheetId);
      } catch (err) {
        logger.error(
          { err, sheetId: bot.sheetId },
          "resetSpreadsheet failed during bot purge — sheet may still contain previous tenant's data, do NOT reassign without manual check"
        );
      }

      await db
        .update(sheetPoolTable)
        .set({ status: "available", assignedBotId: null })
        .where(eq(sheetPoolTable.sheetId, bot.sheetId));

      syncSheetPoolUpsert({ sheet_id: bot.sheetId, assigned_to: null, status: "available" });
      await markSheetTitleFreed(bot.sheetId);
    }
  }

  syncDeletionQueueAdd({
    bot_token: plainToken,
    tenant_sheet_id: bot.sheetId ?? null,
    requested_by: requestedBy,
  });
}
