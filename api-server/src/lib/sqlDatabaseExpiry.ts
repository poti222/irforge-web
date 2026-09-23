/**
 * lib/sqlDatabaseExpiry.ts — IRFORGE_PAID_SQL_DATABASE_PROMPT, the recurring
 * side. Mirrors lib/tierExpiry.ts's sweep shape exactly (same no-cron-infra
 * `setInterval` pattern, same `createNotification` dedup-by-date-key trick)
 * but with a deliberately different failure behavior, per an explicit user
 * decision: a tier's expired bot just gets switched off and kept billed
 * until the owner pays — there's no data to move. Here there's real data
 * sitting on Postgres, so on a failed renewal we immediately (no grace
 * period) kick off the reverse migration back to Sheets rather than leaving
 * a paid dataset stranded on SQL with nobody paying for it.
 *
 * 2026-09-23 — the SQL database purchase became one-time/unlimited
 * (`botDatabase.ts::SQL_DATABASE_UNLIMITED_EXPIRY`, a sentinel far in the
 * future) instead of a recurring monthly charge, so every *new* purchase's
 * `databaseSqlExpiresAt` never satisfies `<= now` below — this sweep is
 * effectively dormant for them, by design, with no code change needed here:
 * the existing date comparisons already do the right thing for a sentinel
 * that far out. Left in place (not deleted) as a defensive no-op in case
 * any pre-existing dated expiry is still around.
 */
import { db, botsTable } from "@workspace/db";
import { eq, isNotNull } from "drizzle-orm";
import { deductWallet } from "./wallet.js";
import { tomanToRial } from "./currency.js";
import { createNotification, formatTomanFa } from "./notify.js";
import { addOneMonth } from "./tierExpiry.js";
import { SQL_DATABASE_PRICE_TOMAN, startSheetsReversion } from "./botDatabase.js";
import { logger } from "./logger.js";

/** How many days ahead of the renewal deadline the owner gets warned — same
 * lead time as the tier sweep, for a consistent "you have N days" UX. */
export const SQL_DB_WARN_DAYS_BEFORE = 3;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type BotRow = typeof botsTable.$inferSelect;

async function warnUpcomingExpiry(bot: BotRow): Promise<void> {
  const dateKey = bot.databaseSqlExpiresAt!.toISOString().slice(0, 10);
  await createNotification({
    userId: bot.userId,
    botId: bot.id,
    type: "sql_database_expiry_warning",
    severity: "warning",
    title: "اشتراک دیتابیس SQL رو به پایان است",
    message: `اشتراکِ ماهانه‌ی دیتابیسِ SQL بات «${bot.name}» تا ${dateKey} تمدید می‌شود. اگر موجودی کیف پول کافی نباشد، دیتای بات به‌صورت خودکار به Google Sheet بازمی‌گردد.`,
    dedupeKey: `sql-db-expiry-warn:${bot.id}:${dateKey}`,
  });
}

async function handleExpiredSqlDatabase(bot: BotRow): Promise<void> {
  const renewed = await deductWallet(
    bot.userId,
    tomanToRial(SQL_DATABASE_PRICE_TOMAN),
    `Auto-renew: SQL database for ${bot.name}`
  );

  if (renewed) {
    const nextExpiry = addOneMonth(bot.databaseSqlExpiresAt!);
    await db.update(botsTable).set({ databaseSqlExpiresAt: nextExpiry }).where(eq(botsTable.id, bot.id));
    await createNotification({
      userId: bot.userId,
      botId: bot.id,
      type: "sql_database_auto_renewed",
      severity: "info",
      title: "اشتراک دیتابیس SQL به‌صورت خودکار تمدید شد",
      message: `${formatTomanFa(SQL_DATABASE_PRICE_TOMAN)} برای تمدیدِ دیتابیسِ SQL بات «${bot.name}» از کیف پول کسر شد.`,
      dedupeKey: `sql-db-renewed:${bot.id}:${nextExpiry.toISOString().slice(0, 10)}`,
    });
    return;
  }

  // بدون مهلت: همین لحظه databaseSqlExpiresAt پاک می‌شود (پس sweep بعدی
  // دیگر این بات را نمی‌بیند — شرطِ isNotNull پایین) و بازگشتِ خودکار به
  // Sheet صف می‌شود. bot.sheetId همیشه موجود است چون این سطر اصلاً فقط
  // برای باتی با databaseSqlExpiresAt غیرنال بار می‌شود، و آن ستون تنها از
  // مسیرِ activate-sql (که خودش نبودِ sheetId را رد می‌کند) ست می‌شود.
  await db.update(botsTable).set({ databaseSqlExpiresAt: null }).where(eq(botsTable.id, bot.id));
  await startSheetsReversion(bot.sheetId!, bot.userId);
  await createNotification({
    userId: bot.userId,
    botId: bot.id,
    type: "sql_database_reverted",
    severity: "critical",
    title: "دیتابیس SQL به دلیل عدم تمدید غیرفعال شد",
    message: `موجودی کیف پول برای تمدیدِ خودکارِ دیتابیسِ SQL بات «${bot.name}» کافی نبود. دیتای بات در حال بازگشت به Google Sheet است — بدون بازگشتِ وجه.`,
    dedupeKey: `sql-db-reverted:${bot.id}:${bot.databaseSqlExpiresAt!.toISOString().slice(0, 10)}`,
  });
}

/** One sweep pass — call periodically. Never throws; a single bot's failure
 * is logged and skipped so it can't stop every other bot's check. */
export async function sweepSqlDatabaseExpiry(): Promise<void> {
  const now = new Date();
  const warnThreshold = new Date(now.getTime() + SQL_DB_WARN_DAYS_BEFORE * ONE_DAY_MS);

  let bots: BotRow[];
  try {
    bots = await db.select().from(botsTable).where(isNotNull(botsTable.databaseSqlExpiresAt));
  } catch (err) {
    logger.error({ err }, "sweepSqlDatabaseExpiry: failed to load bots");
    return;
  }

  for (const bot of bots) {
    if (!bot.databaseSqlExpiresAt) continue;

    try {
      if (bot.databaseSqlExpiresAt > now) {
        if (bot.databaseSqlExpiresAt <= warnThreshold) await warnUpcomingExpiry(bot);
        continue;
      }
      await handleExpiredSqlDatabase(bot);
    } catch (err) {
      logger.error({ err, botId: bot.id }, "sweepSqlDatabaseExpiry: per-bot failure (skipped)");
    }
  }
}
