/**
 * lib/tierExpiry.ts — IRFORGE_MONTHLY_TIER_EXPIRY_PROMPT
 * ─────────────────────────────────────────────────────────────────────────────
 * Standard/Pro bot packages used to be a one-time forever purchase (no expiry
 * concept existed at all — see `bots.tierExpiresAt`'s own doc comment in
 * schema/bots.ts). Now they're monthly: this sweep runs periodically
 * (wired into `index.ts` via `setInterval`, same no-cron-infra pattern every
 * other periodic job in this codebase already uses — `expireStaleTopups`,
 * `refreshExchangeRateFromApi`) and, for every bot with a tier and an expiry
 * date:
 *
 *   - warns the owner a few days before the deadline (once per cycle, via
 *     `createNotification`'s own `dedupeKey` dedup — no separate "already
 *     warned" column needed);
 *   - once the deadline has passed, tries to auto-charge the wallet for one
 *     more month at the tier's *current* price (`getBotTierProduct`, not
 *     whatever they originally paid — a real subscription re-prices on
 *     renewal, same as any other recurring billing);
 *   - if that charge succeeds, extends `tierExpiresAt` by one month and (if
 *     the bot had been sitting expired) turns it back on;
 *   - if the wallet doesn't have enough, flips `bots.status` to
 *     `"tier_expired"` and pushes that through `syncTenantUpsert` — the ONLY
 *     thing that actually stops the bot from answering end users. No new
 *     mechanism was built on the irforge-app side for this: `bot_status_gate.py`
 *     already drops every Telegram update for a tenant whose last-known
 *     registry status isn't the literal string `"active"`, silently, before
 *     any handler runs. This sweep just has to make that string stop being
 *     "active", the same way the existing Start/Stop toggle
 *     (`PATCH /bots/:botId/status`) already does.
 *
 * A bot the owner has manually turned off (`status: "inactive"`) still gets
 * billed and can still expire — the monthly charge is for owning the tier,
 * not for the bot being turned on at any given moment, same as any real
 * subscription.
 */
import { db, botsTable, usersTable } from "@workspace/db";
import { and, eq, isNotNull } from "drizzle-orm";
import { getBotTierProduct } from "./pluginPricing.js";
import { deductWallet } from "./wallet.js";
import { tomanToRial } from "./currency.js";
import { createNotification, formatTomanFa } from "./notify.js";
import { syncTenantUpsert } from "./sheetsSync.js";
import { decryptToken } from "./tokenCrypto.js";
import { logger } from "./logger.js";

export const TIER_EXPIRED_STATUS = "tier_expired";
/** How many days ahead of the deadline the owner gets warned. */
export const WARN_DAYS_BEFORE = 3;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type BotRow = typeof botsTable.$inferSelect;

/** Calendar-month add (Jan 31 + 1 month → Mar 3, same overflow JS's own
 * `setMonth` already does for a short next month) — used for both the first
 * purchase (routes/bots.ts) and every renewal here, so the two stay
 * consistent with each other. */
export function addOneMonth(date: Date): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + 1);
  return d;
}

/** Pushes this bot's current `status` through to the registry the bot side
 * actually reads (`bot_status_gate.py`) — the exact same call
 * `PATCH /bots/:botId/status` already makes, reused here since a status
 * change our own code makes needs to reach the bot exactly the same way a
 * manual Start/Stop toggle does. A no-op for a bot with no sheet assigned
 * yet (never registered as a live tenant, so nothing to sync). */
async function syncBotStatusToRegistry(bot: BotRow): Promise<void> {
  if (!bot.sheetId) return;
  const [owner] = await db.select({ telegramId: usersTable.telegramId })
    .from(usersTable).where(eq(usersTable.id, bot.userId)).limit(1);
  syncTenantUpsert({
    bot_token: decryptToken(bot.token),
    bot_name: bot.name,
    bot_username: bot.username,
    owner_user_id: bot.userId,
    owner_telegram_id: owner?.telegramId ?? null,
    sheet_id: bot.sheetId,
    admin_password: bot.adminCode ?? "",
    status: bot.status,
    created_at: bot.createdAt,
  });
}

async function warnUpcomingExpiry(bot: BotRow): Promise<void> {
  const dateKey = bot.tierExpiresAt!.toISOString().slice(0, 10);
  await createNotification({
    userId: bot.userId,
    botId: bot.id,
    type: "tier_expiry_warning",
    severity: "warning",
    title: "دوره‌ی پکیج باتتان رو به پایان است",
    message: `پکیج «${bot.tier === "pro" ? "پرو" : "استاندارد"}» بات «${bot.name}» تا ${dateKey} تمدید می‌شود. اگر موجودی کیف پول کافی نباشد، بات خاموش خواهد شد تا تمدید کنید.`,
    // یک‌بار به‌ازای هر مهلت، نه هر تیکِ sweep — کلیدش خودِ تاریخِ انقضا است،
    // پس یک تمدیدِ موفق (که تاریخ را عوض می‌کند) خودش‌به‌خود یک هشدارِ تازه
    // برای دوره‌ی بعدی را دوباره ممکن می‌کند.
    dedupeKey: `tier-expiry-warn:${bot.id}:${dateKey}`,
  });
}

async function handleExpiredBot(bot: BotRow): Promise<void> {
  const product = bot.tier ? await getBotTierProduct(bot.tier) : null;
  const renewed = product ? await deductWallet(bot.userId, tomanToRial(product.priceToman), `Auto-renew: ${bot.tier} plan for ${bot.name}`) : false;

  if (renewed && product) {
    const nextExpiry = addOneMonth(bot.tierExpiresAt!);
    const wasExpired = bot.status === TIER_EXPIRED_STATUS;
    const [updated] = await db.update(botsTable)
      .set({ tierExpiresAt: nextExpiry, status: wasExpired ? "active" : bot.status })
      .where(eq(botsTable.id, bot.id))
      .returning();
    if (wasExpired) await syncBotStatusToRegistry(updated);
    await createNotification({
      userId: bot.userId,
      botId: bot.id,
      type: "tier_auto_renewed",
      severity: "info",
      title: "پکیج بات به‌صورت خودکار تمدید شد",
      message: `${formatTomanFa(product.priceToman)} برای تمدیدِ یک‌ماهه‌ی پکیج بات «${bot.name}» از کیف پول کسر شد.`,
      dedupeKey: `tier-renewed:${bot.id}:${nextExpiry.toISOString().slice(0, 10)}`,
    });
    return;
  }

  // از قبل خاموش‌شده و همان لحظه دوباره ناموفق بود — دوباره اعلان نده،
  // فقط sweep‌ِ بعدی (اگر کیف‌پول شارژ شد) خودش تلاش می‌کند.
  if (bot.status === TIER_EXPIRED_STATUS) return;

  const [updated] = await db.update(botsTable).set({ status: TIER_EXPIRED_STATUS }).where(eq(botsTable.id, bot.id)).returning();
  await syncBotStatusToRegistry(updated);
  await createNotification({
    userId: bot.userId,
    botId: bot.id,
    type: "tier_expired",
    severity: "critical",
    title: "بات شما خاموش شد",
    message: `دوره‌ی پکیج بات «${bot.name}» به پایان رسید و موجودی کیف پول برای تمدیدِ خودکار کافی نبود. بات دیگر به کاربرانش پاسخ نمی‌دهد تا تمدید کنید.`,
    dedupeKey: `tier-expired:${bot.id}:${bot.tierExpiresAt!.toISOString().slice(0, 10)}`,
  });
}

/** One sweep pass — call periodically. Never throws; a single bot's failure
 * is logged and skipped so it can't stop every other bot's check. */
export async function sweepTierExpiry(): Promise<void> {
  const now = new Date();
  const warnThreshold = new Date(now.getTime() + WARN_DAYS_BEFORE * ONE_DAY_MS);

  let bots: BotRow[];
  try {
    bots = await db.select().from(botsTable)
      .where(and(isNotNull(botsTable.tier), isNotNull(botsTable.tierExpiresAt)));
  } catch (err) {
    logger.error({ err }, "sweepTierExpiry: failed to load bots");
    return;
  }

  for (const bot of bots) {
    if (!bot.tierExpiresAt) continue;
    if (bot.tier !== "standard" && bot.tier !== "pro") continue; // custom/unknown never auto-billed

    try {
      if (bot.tierExpiresAt > now) {
        if (bot.tierExpiresAt <= warnThreshold) await warnUpcomingExpiry(bot);
        continue;
      }
      await handleExpiredBot(bot);
    } catch (err) {
      logger.error({ err, botId: bot.id }, "sweepTierExpiry: per-bot failure (skipped)");
    }
  }
}
