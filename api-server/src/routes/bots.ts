/**
 * routes/bots.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * FIX [Group 3+4]:
 *   - POST /api/bots: فلوی کامل با فیش پرداخت → pending_payment
 *   - POST /api/bots/activate-admin-code: وارد کردن admin code → فعال‌سازی پنل
 *   - POST /api/bots/:botId/approve-payment: سوپرادمین تأیید می‌کنه
 *   - POST /api/bots/:botId/reject-payment: سوپرادمین رد می‌کنه
 *   - POST /api/bots/pending-payments/:paymentId/cancel: کنسل کامل سفارش (حتی اگه بات حذف شده باشه)
 *   - GET  /api/bots/pending-payments: لیست فیش‌های منتظر (سوپرادمین)
 *   - POST /api/sheet-pool: اضافه کردن شیت به pool (سوپرادمین)
 *   - DELETE /api/sheet-pool/:id: حذف شیت آزاد از pool (سوپرادمین)
 *   - POST /api/sheet-pool/:id/replace: جایگزینی شیت (آزاد یا assigned) با یک شیت دیگه
 *   - POST /api/sheet-pool/:id/release: خالی کردن دستی شیت (آزادسازی از هر باتی، برای دیتای قدیمی/گیر کرده)
 *   - sheetTitleForBot/syncSheetTitle: عنوان شیت هر بات "irforge-{نام بات}" نگه داشته می‌شه، هر جا بات ساخته/رینیم/ری‌اساین بشه
 */

import { logger } from "../lib/logger";
import { Router } from "express";
import {
  db,
  botsTable,
  commandsTable,
  installedPluginsTable,
  activityTable,
  marketplaceItemsTable,
  paymentsTable,
  sheetPoolTable,
  usersTable,
  walletsTable,
  walletTransactionsTable,
  discountCodesTable,
  discountRedemptionsTable,
} from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { computeDiscount, type DiscountKind } from "../lib/discounts";
import crypto from "crypto";
import { requireAuth } from "./auth";
import { encryptToken, decryptToken } from "../lib/tokenCrypto";
import { sendTelegramMessage, tgApi, tgSetProfilePhoto, fetchBotIdentity, getTelegramFilePath } from "../lib/telegram";
import {
  syncBotUpsert,
  syncBotDelete,
  syncPaymentUpsert,
  syncSheetPoolUpsert,
  syncSheetPoolDelete,
  syncTenantUpsert,
  syncTenantDelete,
  syncDeletionQueueAdd,
  readAllKV,
  readKV,
  registrySheetId,
} from "../lib/sheetsSync";
import { getBotLanguage, setBotLanguage, parseBotLanguageConfig } from "../lib/botLanguageStore";
import { renameSpreadsheet, sheetIsAccessible } from "../lib/sheets";
import { readTabRows } from "../lib/tenantSheets.js";
import { evaluateBotTrial, trialDaysLeft } from "../lib/trial";
import { createNotification, formatTomanFa } from "../lib/notify";

const router = Router();

/** A Google Spreadsheet ID is ~20-60 chars of [A-Za-z0-9_-]. */
function isValidSheetId(id: string): boolean {
  return /^[A-Za-z0-9_-]{20,120}$/.test(id);
}

// ─── Sheet title ↔ bot name sync ─────────────────────────────────────────────
// هر شیتی که به یک بات اختصاص داده می‌شه باید اسمش "irforge-{نام بات}" باشه
// (فاصله‌ها با خط‌تیره جایگزین می‌شن، مثلاً «کوزه سازان» → «irforge-کوزه-سازان»).
// هر جا اسم بات تغییر کنه یا شیتش عوض بشه، باید این عنوان دوباره sync بشه —
// همه‌ی محل‌هایی که شیت assign/replace می‌کنن یا اسم بات رو آپدیت می‌کنن این
// helper رو صدا می‌زنن. Best-effort و non-fatal: اگه rename fail بشه (مثلاً
// دسترسی گوگل قطع باشه)، فقط لاگ می‌کنیم و درخواست اصلی رو خراب نمی‌کنیم.

function sheetTitleForBot(botName: string): string {
  const slug = botName.trim().replace(/\s+/g, "-");
  return `irforge-${slug}`;
}

async function syncSheetTitle(sheetId: string | null | undefined, botName: string) {
  if (!sheetId) return;
  try {
    await renameSpreadsheet(sheetId, sheetTitleForBot(botName));
  } catch (err) {
    logger.warn({ err, sheetId }, "sheet title sync failed (non-fatal)");
  }
}

/**
 * وقتی شیتی از یک بات آزاد می‌شه (چه با حذف بات، چه با release دستی توسط
 * سوپرادمین)، عنوانش رو "~" می‌کنیم تا مشخص باشه دیگه هیچ بات فعالی
 * ازش استفاده نمی‌کنه. Best-effort و non-fatal، مثل syncSheetTitle.
 */
async function markSheetTitleFreed(sheetId: string | null | undefined) {
  if (!sheetId) return;
  try {
    await renameSpreadsheet(sheetId, "~");
  } catch (err) {
    logger.warn({ err, sheetId }, "sheet title freed-rename failed (non-fatal)");
  }
}

const VALID_BOT_STATUSES = ["active", "inactive", "error", "pending_payment", "payment_rejected", "expired"] as const;
type BotStatus = typeof VALID_BOT_STATUSES[number];

// ─── Shared full-purge logic (manual delete + expiry-triggered internal purge) ─
// See docs/DELETION_POLICY.md. Deletes the bot's site Postgres rows, then
// fires the registry/sheet-pool/deletion-queue syncs — the two previously
// written-but-never-called `syncTenantDelete`/`syncSheetPoolUpsert` functions
// are wired in here, plus the new `syncDeletionQueueAdd`.
async function purgeBotFully(
  bot: { id: string; token: string; sheetId: string | null },
  requestedBy: "manual" | "expiry"
) {
  await db.delete(commandsTable).where(eq(commandsTable.botId, bot.id));
  await db.delete(installedPluginsTable).where(eq(installedPluginsTable.botId, bot.id));
  await db.delete(botsTable).where(eq(botsTable.id, bot.id));

  syncBotDelete(bot.id);

  const plainToken = decryptToken(bot.token);
  syncTenantDelete(plainToken);

  if (bot.sheetId) {
    // BUG FIX: این فقط رجیستری گوگل‌شیت رو آزاد می‌کرد، نه ردیف واقعی
    // sheet_pool توی Postgres — در نتیجه بعد از حذف بات (چه دستی، چه با
    // expiry، چه توسط خود کاربر)، شیت توی پنل همچنان "assigned" می‌موند و
    // نه قابل استفاده‌ی مجدد بود نه قابل حذف. حالا هر دو رو آزاد می‌کنیم.
    await db
      .update(sheetPoolTable)
      .set({ status: "available", assignedBotId: null })
      .where(eq(sheetPoolTable.sheetId, bot.sheetId));

    syncSheetPoolUpsert({ sheet_id: bot.sheetId, assigned_to: null, status: "available" });
    await markSheetTitleFreed(bot.sheetId);
  }

  syncDeletionQueueAdd({
    bot_token: plainToken,
    tenant_sheet_id: bot.sheetId ?? null,
    requested_by: requestedBy,
  });
}

// ─── requireSuperAdmin ───────────────────────────────────────────────────────

function requireSuperAdmin(req: any, res: any, next: any) {
  requireAuth(req, res, async () => {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.userId))
      .limit(1);
    if (!user || user.role !== "super_admin") {
      res.status(403).json({ error: "Super admin only" });
      return;
    }
    next();
  });
}

// ─── requireBotOwnership ─────────────────────────────────────────────────────
// FIX [X2]: the commands/plugins sub-routes previously used bare `requireAuth`,
// so any authenticated user could read/mutate another user's bot by guessing
// its :botId. This middleware scopes :botId to the caller and attaches the row
// as req.bot for the handler to reuse.

function requireBotOwnership(req: any, res: any, next: any) {
  requireAuth(req, res, async () => {
    try {
      const [bot] = await db
        .select()
        .from(botsTable)
        .where(and(eq(botsTable.id, req.params.botId), eq(botsTable.userId, req.userId)))
        .limit(1);
      if (!bot) {
        res.status(404).json({ error: "Bot not found" });
        return;
      }
      req.bot = bot;
      next();
    } catch (err) {
      logger.error({ err }, "requireBotOwnership error");
      res.status(500).json({ error: "Internal server error" });
    }
  });
}

// ─── helpers ────────────────────────────────────────────────────────────────

function formatBot(bot: any) {
  return {
    id: bot.id,
    name: bot.name,
    description: bot.description,
    status: bot.status,
    token: decryptToken(bot.token),
    userId: bot.userId,
    username: bot.username,
    avatar: bot.avatar,
    commandCount: bot.commandCount,
    pluginCount: bot.pluginCount,
    userCount: bot.userCount,
    messageCount: bot.messageCount,
    sheetId: bot.sheetId ?? null,
    adminCode: bot.adminCode ?? null,
    orderPhone: bot.orderPhone ?? null,
    orderTelegramId: bot.orderTelegramId ?? null,
    paymentStatus: bot.paymentStatus,
    isTrial: bot.isTrial ?? false,
    trialExpiresAt: bot.trialExpiresAt ? bot.trialExpiresAt.toISOString() : null,
    trialDaysLeft: bot.isTrial ? trialDaysLeft(bot.trialExpiresAt) : null,
    createdAt: bot.createdAt.toISOString(),
    updatedAt: bot.updatedAt.toISOString(),
  };
}

/** تولید admin code — ۸ کاراکتر hex */
function generateAdminCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

/**
 * چک تکراری نبودن توکن.
 * توکن‌ها با IV رندوم رمزنگاری می‌شن، پس نمی‌شه رو دیتابیس یونیک‌شون کرد؛
 * برای همین همه‌ی بات‌های موجود دیکریپت و مقایسه می‌شن (همون روش /admin/bots).
 * بدون این چک، وارد کردن یک توکن تکراری دو بات جدا (با دو سیم‌شیت/ادمین‌کد
 * جدا) می‌سازه که هر دو سعی می‌کنن روی همون بات تلگرام کار کنن.
 */
async function isTokenAlreadyUsed(token: string): Promise<boolean> {
  const existingBots = await db.select().from(botsTable);
  return existingBots.some((b) => {
    try {
      return decryptToken(b.token) === token;
    } catch {
      return false;
    }
  });
}

// ─── Live stats overlay ───────────────────────────────────────────────────────
// FIX: bot.userCount / commandCount / pluginCount in Postgres are dead
// counters — nothing in mainbot ever updates them, because mainbot writes
// real usage data into the BOT'S OWN Google Sheet (tabs "users" and
// "custom_commands", plus the "__plugin_states__" key inside "bot_settings"
// for which plugins are enabled), never touching this site's Postgres. The
// Overview cards were reading the frozen Postgres value (0, from creation
// time) instead. This overlays live counts read straight from the sheet
// whenever one is assigned.
//
// "Messages" is NOT included here: mainbot has no message counter anywhere
// (checked handlers/*, utils/event_engine.py — no such event is emitted), so
// there is nothing to read yet. Fixing it needs a small mainbot-side change
// (increment a counter, or emit + count a "message.received" event) before
// the site can show a real number — flagging this rather than showing a
// fabricated figure.

const liveCountsCache = new Map<
  string,
  { at: number; counts: { userCount: number; commandCount: number; pluginCount: number } }
>();
const LIVE_COUNTS_CACHE_MS = 15_000; // shared Sheets API quota — don't refetch on every click

async function getLiveBotCounts(sheetId: string) {
  const cached = liveCountsCache.get(sheetId);
  if (cached && Date.now() - cached.at < LIVE_COUNTS_CACHE_MS) return cached.counts;

  const [usersRows, cmdRows, settingsRows] = await Promise.all([
    readTabRows(sheetId, "users").catch(() => []),
    readTabRows(sheetId, "custom_commands").catch(() => []),
    readTabRows(sheetId, "bot_settings").catch(() => []),
  ]);

  let pluginCount = 0;
  const statesRow = settingsRows.find((r) => r.key === "__plugin_states__");
  if (statesRow && statesRow.value && typeof statesRow.value === "object") {
    pluginCount = Object.values(statesRow.value as Record<string, unknown>).filter(Boolean).length;
  }

  const counts = { userCount: usersRows.length, commandCount: cmdRows.length, pluginCount };
  liveCountsCache.set(sheetId, { at: Date.now(), counts });
  return counts;
}

/** formatBot() + live counts overlay from the bot's own sheet (falls back to the stored row when there's no sheet yet, or the read fails). */
async function formatBotWithLiveStats(bot: any) {
  const base = formatBot(bot);
  if (!bot.sheetId) return base;
  try {
    const live = await getLiveBotCounts(bot.sheetId);
    return { ...base, userCount: live.userCount, commandCount: live.commandCount, pluginCount: live.pluginCount };
  } catch (err) {
    logger.warn({ err, botId: bot.id }, "live stats overlay failed, falling back to stored counts");
    return base;
  }
}

// ─── Phase 7: lazy identity backfill ───────────────────────────────────────
// Bots created before fetchBotIdentity existed (or whose creation-time fetch
// failed) sit with username=null forever otherwise. GET /bots and
// GET /bots/:botId opportunistically fill it in — but a bot with a
// revoked/invalid token must not trigger a Telegram call on every single
// page load, so each bot is retried at most once per hour via this
// in-process TTL map (matches the "in-process TTL map is fine" option in the
// phase spec; not persisted, so it resets on deploy — acceptable since a
// cold cache just means one extra retry, not repeated hammering).
const identityBackfillAttempts = new Map<string, number>();
const IDENTITY_BACKFILL_RETRY_MS = 60 * 60 * 1000; // 1h

/**
 * If `bot` still has no username and isn't sitting in pending_payment (not
 * yet a confirmed real bot), fetch its identity from Telegram and persist it.
 * Mutates nothing when the guard skips or the fetch comes back empty.
 * Returns the (possibly updated) bot row.
 */
async function backfillBotIdentityIfStale<T extends { id: string; token: string; username: string | null; status: string }>(
  bot: T
): Promise<T> {
  if (bot.username || bot.status === "pending_payment") return bot;

  const lastAttempt = identityBackfillAttempts.get(bot.id);
  if (lastAttempt && Date.now() - lastAttempt < IDENTITY_BACKFILL_RETRY_MS) return bot;
  identityBackfillAttempts.set(bot.id, Date.now());

  let plainToken: string;
  try {
    plainToken = decryptToken(bot.token);
  } catch (err) {
    logger.warn({ err, botId: bot.id }, "identity backfill: token decrypt failed");
    return bot;
  }

  const identity = await fetchBotIdentity(plainToken);
  if (!identity.username && !identity.avatarFileId) return bot;

  const update: Record<string, any> = {};
  if (identity.username) update.username = identity.username;
  if (identity.avatarFileId) {
    update.avatarFileId = identity.avatarFileId;
    update.avatar = `/api/bots/${bot.id}/avatar`;
  }
  await db.update(botsTable).set(update).where(eq(botsTable.id, bot.id));
  return { ...bot, ...update };
}

/**
 * Z6: deduct from a user's wallet for a cart purchase. Returns false when the
 * balance can't cover it. A zero/negative amount (e.g. a free plugin, or a
 * discount code that zeroed the order) is a no-op that succeeds. Funds are
 * considered verified, so it records an approved spend.
 *
 * `executor` defaults to the module-level `db` but accepts a `db.transaction`
 * callback's `tx` too — Phase 11's discount-code purchase needs the balance
 * check, the deduction, and the discount-code row update to commit or roll
 * back together.
 */
async function deductWallet(userId: string, amount: number, note: string, executor: any = db): Promise<boolean> {
  const amt = Math.round(Number(amount) || 0);
  if (amt <= 0) return true;
  const [wallet] = await executor.select().from(walletsTable).where(eq(walletsTable.userId, userId)).limit(1);
  if (!wallet || wallet.balance < amt) return false;
  await executor.update(walletsTable).set({ balance: wallet.balance - amt }).where(eq(walletsTable.userId, userId));
  await executor.insert(walletTransactionsTable).values({
    id: crypto.randomUUID(), userId, type: "spend", amount: amt, status: "approved", reviewNote: note,
  });
  return true;
}

// ─── Discount-code application (Phase 11) ───────────────────────────────────
// Shared by any wallet purchase that accepts an optional discount code. The
// code is re-validated from scratch here — a client-supplied discountAmount
// or finalAmount is never trusted — and this is meant to run inside the same
// db.transaction() as the wallet deduction, row-locked, so a code can't be
// spent past its maxUses by two concurrent purchases racing each other.

type DiscountReason = "not_found" | "inactive" | "expired" | "exhausted";

class DiscountCodeError extends Error {
  constructor(public reason: DiscountReason, message: string) {
    super(message);
  }
}

/** Thrown inside a purchase transaction to signal a clean rollback — the wallet
 *  balance couldn't cover the (possibly discounted) total, so nothing should
 *  commit, including any discount-code redemption already staged in the same tx. */
class InsufficientBalanceError extends Error {}

const DISCOUNT_ERROR_MESSAGES_FA: Record<DiscountReason, string> = {
  not_found: "کد تخفیف پیدا نشد",
  inactive: "این کد تخفیف غیرفعال است",
  expired: "این کد تخفیف منقضی شده است",
  exhausted: "سقف استفاده از این کد تخفیف پر شده است",
};

/**
 * Locks and validates a discount code inside an in-flight transaction, then
 * atomically records its use: increments `usedCount` and writes an audit
 * `discount_redemptions` row. Returns the discounted amount to actually
 * charge. Throws `DiscountCodeError` (never a bare 500) when the code can't
 * be applied — including when it became exhausted between the checkout-page
 * quote and this purchase, which is exactly what the row lock prevents from
 * silently charging full price instead.
 */
async function applyDiscountCode(
  tx: any,
  rawCode: string,
  userId: string,
  orderAmount: number,
): Promise<{ discountAmount: number; finalAmount: number; codeId: string }> {
  const code = rawCode.trim().toUpperCase();
  const [row] = await tx
    .select()
    .from(discountCodesTable)
    .where(eq(discountCodesTable.code, code))
    .for("update")
    .limit(1);

  if (!row) throw new DiscountCodeError("not_found", DISCOUNT_ERROR_MESSAGES_FA.not_found);
  if (!row.active) throw new DiscountCodeError("inactive", DISCOUNT_ERROR_MESSAGES_FA.inactive);
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    throw new DiscountCodeError("expired", DISCOUNT_ERROR_MESSAGES_FA.expired);
  }
  if (row.maxUses != null && row.usedCount >= row.maxUses) {
    throw new DiscountCodeError("exhausted", DISCOUNT_ERROR_MESSAGES_FA.exhausted);
  }

  const { discountAmount, finalAmount } = computeDiscount(row.kind as DiscountKind, row.value, orderAmount);

  await tx.update(discountCodesTable).set({ usedCount: sql`${discountCodesTable.usedCount} + 1` }).where(eq(discountCodesTable.id, row.id));
  await tx.insert(discountRedemptionsTable).values({
    id: crypto.randomUUID(),
    codeId: row.id,
    userId,
    orderAmount: Math.round(orderAmount),
    discountAmount,
    createdAt: new Date(),
  });

  return { discountAmount, finalAmount, codeId: row.id };
}

// ─── Registry reconciliation ──────────────────────────────────────────────────
// FIX: Google Sheets (registry `tenants` tab) is now the real source of truth
// for "which bots exist and who owns them" — not Postgres. Bots created
// entirely outside this site (through the bot itself, never touching
// POST /api/bots) only ever land in the registry sheet, so any endpoint that
// listed bots straight from Postgres would silently miss them forever.
//
// Every read below self-heals Postgres from the registry first:
//   - a tenant with no matching Postgres row (matched by decrypted token,
//     which is 1:1 with a Telegram bot) gets imported
//   - a tenant whose Postgres row exists under the wrong user_id gets
//     reassigned to its real owner
// Postgres remains the day-to-day store for everything the registry doesn't
// carry (commands, plugins, stats) — but for existence/ownership, the sheet
// wins and Postgres is treated as a cache of it.

type RegistryTenant = {
  bot_token: string;
  bot_name?: string;
  bot_username?: string | null;
  owner_id?: string | null; // telegram id — what mainbot writes when it creates a tenant directly
  owner_user_id?: string | null; // legacy site-account alias
  spreadsheet_id?: string | null;
  sheet_id?: string | null;
  admin_password?: string | null;
  status?: string;
};

// Short in-memory cache so a burst of dashboard loads doesn't hammer the
// Sheets API (quota is per-project, shared with mainbot/support-bot too).
let tenantsCache: { at: number; rows: RegistryTenant[] } | null = null;
const TENANTS_CACHE_MS = 15_000;

async function readAllTenants(force = false): Promise<RegistryTenant[]> {
  const spreadsheetId = registrySheetId();
  if (!spreadsheetId) return [];
  if (!force && tenantsCache && Date.now() - tenantsCache.at < TENANTS_CACHE_MS) return tenantsCache.rows;
  const rows = await readAllKV<RegistryTenant>(spreadsheetId, "tenants");
  tenantsCache = { at: Date.now(), rows };
  return rows;
}

/**
 * Import/repair this user's bots from the registry sheet before Postgres is
 * read. `telegramId` is required to match ownership because that's the key
 * mainbot writes (`owner_id`) when a bot is created directly through the bot.
 */
async function reconcileBotsFromRegistry(userId: string, telegramId: string | null) {
  let tenants: RegistryTenant[];
  try {
    tenants = await readAllTenants();
  } catch (err) {
    logger.warn({ err }, "registry reconcile: failed to read tenants tab");
    return;
  }
  if (tenants.length === 0) return;

  const mine = tenants.filter(
    (t) => (telegramId && t.owner_id === telegramId) || t.owner_user_id === userId
  );
  if (mine.length === 0) return;

  // Registry stores tokens in plaintext; Postgres stores them AES-GCM
  // encrypted with a random IV each time, so ciphertexts can't be compared
  // directly — decrypt once and match on plaintext token instead.
  const allBots = await db.select().from(botsTable);
  const byToken = new Map<string, (typeof allBots)[number]>();
  for (const b of allBots) {
    try {
      byToken.set(decryptToken(b.token), b);
    } catch {
      /* corrupt/legacy row — skip */
    }
  }

  for (const t of mine) {
    if (!t.bot_token) continue;
    const existing = byToken.get(t.bot_token);
    const sheetId = t.spreadsheet_id || t.sheet_id || null;

    if (existing) {
      if (existing.userId !== userId) {
        await db.update(botsTable).set({ userId }).where(eq(botsTable.id, existing.id));
      }
      continue;
    }

    // No Postgres row at all — this tenant was created entirely outside the
    // site (through the bot itself). Import it so the rest of the app
    // (commands, plugins, stats, settings) has something to attach to.
    const newId = crypto.randomUUID();
    const [imported] = await db
      .insert(botsTable)
      .values({
        id: newId,
        name: t.bot_name || "Bot",
        description: null,
        token: encryptToken(t.bot_token),
        userId,
        username: t.bot_username ?? null,
        status: t.status === "active" ? "active" : "inactive",
        paymentStatus: "approved",
        sheetId,
        adminCode: t.admin_password || null,
      })
      .returning();
    byToken.set(t.bot_token, imported);
  }
}

// ─── GET /api/bots ───────────────────────────────────────────────────────────

router.get("/bots", requireAuth, async (req: any, res) => {
  try {
    const [user] = await db
      .select({ telegramId: usersTable.telegramId })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId))
      .limit(1);
    await reconcileBotsFromRegistry(req.userId, user?.telegramId ?? null);

    const bots = await db
      .select()
      .from(botsTable)
      .where(eq(botsTable.userId, req.userId));
    const withIdentity = await Promise.all(bots.map(backfillBotIdentityIfStale));
    const evaluated = await Promise.all(
      withIdentity.map((b) => (b.isTrial ? evaluateBotTrial(b) : b))
    );
    res.json(await Promise.all(evaluated.map(formatBotWithLiveStats)));
  } catch (err) {
    logger.error({ err }, "List bots error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/bots ──────────────────────────────────────────────────────────
// FIX [Group 3]: فلوی کامل — فیش پرداخت + pending_payment

router.post("/bots", requireAuth, async (req: any, res) => {
  try {
    const { name, description, token, paymentDescription, receiptUrl, amount } = req.body;

    if (!name || !token) {
      res.status(400).json({ error: "Name and token are required" });
      return;
    }
    if (!receiptUrl) {
      res.status(400).json({ error: "Receipt (receiptUrl) is required" });
      return;
    }

    // چک پروفایل کامل — تلگرام باید وصل باشه
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (!user.telegramId) {
      res.status(400).json({ error: "Please link your Telegram account first" });
      return;
    }

    if (await isTokenAlreadyUsed(token)) {
      res.status(409).json({ error: "This bot token is already registered", code: "duplicate_token" });
      return;
    }

    const botId = crypto.randomUUID();
    const paymentId = crypto.randomUUID();

    // بات هنوز pending_payment هست، ولی توکن از همین الان معتبره — پس همین
    // الان هویت واقعی‌ش رو از تلگرام می‌گیریم تا در صفحه‌ی بررسی فیش (ادمین)
    // و لیست بات‌های خود کاربر @username واقعی دیده بشه، نه "@undefined".
    const identity = await fetchBotIdentity(token);

    // ساخت بات با وضعیت pending_payment
    const [bot] = await db
      .insert(botsTable)
      .values({
        id: botId,
        name,
        description: description ?? null,
        token: encryptToken(token),
        userId: req.userId,
        status: "pending_payment",
        paymentStatus: "pending",
        username: identity.username,
        avatarFileId: identity.avatarFileId,
        avatar: identity.avatarFileId ? `/api/bots/${botId}/avatar` : null,
      })
      .returning();

    // ذخیره فیش پرداخت
    const [payment] = await db
      .insert(paymentsTable)
      .values({
        id: paymentId,
        userId: req.userId,
        botId: botId,
        receiptUrl,
        description: paymentDescription ?? null,
        amount: typeof amount === "number" ? amount : (amount ? Number(amount) : null),
        status: "pending",
      })
      .returning();

    // ثبت activity
    await db.insert(activityTable).values({
      id: crypto.randomUUID(),
      userId: req.userId,
      type: "bot_created",
      title: "Bot submitted",
      description: `Bot "${name}" submitted for review`,
      botName: name,
    });

    // Sync
    syncBotUpsert({
      id: bot.id, userId: bot.userId, name: bot.name, username: bot.username,
      status: bot.status, commandCount: bot.commandCount, pluginCount: bot.pluginCount,
      userCount: bot.userCount, messageCount: bot.messageCount,
      createdAt: bot.createdAt, updatedAt: bot.updatedAt,
    });
    syncPaymentUpsert({
      id: payment.id, userId: payment.userId, amount: 0,
      status: payment.status, planId: null, createdAt: payment.createdAt,
    });

    res.status(201).json(formatBot(bot));
  } catch (err) {
    logger.error({ err }, "Create bot error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/bots/trial ────────────────────────────────────────────────────
// تریال ۷ روزه‌ی رایگان (معادل پکیج نقره‌ای) — بدون فیش، بدون تأیید ادمین،
// فوری فعال می‌شود. شرط: تلگرام وصل باشد و کاربر قبلاً تریال نگرفته باشد.

router.post("/bots/trial", requireAuth, async (req: any, res) => {
  try {
    const { name, token } = req.body ?? {};
    if (!name?.trim() || !token?.trim()) {
      res.status(400).json({ error: "نام و توکن بات الزامی است" });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.userId))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "کاربر پیدا نشد" });
      return;
    }
    if (!user.telegramId) {
      res.status(400).json({ error: "برای استفاده از تریال رایگان ابتدا تلگرامت را وصل کن" });
      return;
    }
    if (user.hasUsedTrial) {
      res.status(409).json({ error: "تو قبلاً از تریال رایگان استفاده کرده‌ای" });
      return;
    }

    const trialExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const botId = crypto.randomUUID();

    // ۱. یک شیت آزاد از Pool بگیر — بدون این، بات هیچ‌وقت spreadsheet_id
    //    نداره و runtime اصلی نمی‌تونه دیتای این tenant رو ذخیره کنه.
    const [freeSheet] = await db
      .select()
      .from(sheetPoolTable)
      .where(eq(sheetPoolTable.status, "available"))
      .limit(1);

    if (!freeSheet) {
      res.status(503).json({ error: "در حال حاضر شیت آزادی برای تریال موجود نیست. بعداً دوباره تلاش کن." });
      return;
    }

    await db
      .update(sheetPoolTable)
      .set({ status: "assigned", assignedBotId: botId })
      .where(eq(sheetPoolTable.id, freeSheet.id));

    // ۲. admin code بساز — برای ورود به پنل ادمین همین بات لازمه
    const adminCode = generateAdminCode();

    const trialToken = token.trim();
    const identity = await fetchBotIdentity(trialToken);

    const [bot] = await db
      .insert(botsTable)
      .values({
        id: botId,
        name: name.trim(),
        description: "تریال ۷ روزه (معادل پکیج نقره‌ای)",
        token: encryptToken(trialToken),
        userId: req.userId,
        status: "active",
        paymentStatus: "approved",
        sheetId: freeSheet.sheetId,
        adminCode,
        isTrial: true,
        trialExpiresAt,
        username: identity.username,
        avatarFileId: identity.avatarFileId,
        avatar: identity.avatarFileId ? `/api/bots/${botId}/avatar` : null,
      })
      .returning();

    await db.update(usersTable).set({ hasUsedTrial: true }).where(eq(usersTable.id, req.userId));

    await syncSheetTitle(freeSheet.sheetId, bot.name);

    await db.insert(activityTable).values({
      id: crypto.randomUUID(),
      userId: req.userId,
      type: "bot_created",
      title: "Trial bot started",
      description: `7-day free trial started for bot "${name}"`,
      botName: name,
    });

    syncSheetPoolUpsert({
      sheet_id: freeSheet.sheetId,
      assigned_to: botId,
      used_by: token.trim(),
      status: "assigned",
    });

    // ۳. Sync tenant (ربط توکن بات به شیت) — همون شکلی که mainbot از
    //    utils/registry.py می‌خونه. قبلاً این call اصلاً اینجا نبود، پس
    //    بات‌های تریال هیچ‌وقت توی تب "tenants" ثبت نمی‌شدن و runtime
    //    اصلی هیچ‌وقت اجراشون نمی‌کرد، با اینکه توی سایت "فعال" نشون
    //    داده می‌شدن.
    const [tenantOwner] = await db
      .select({ telegramId: usersTable.telegramId })
      .from(usersTable).where(eq(usersTable.id, bot.userId)).limit(1);
    syncTenantUpsert({
      bot_token: token.trim(),
      bot_name: bot.name,
      bot_username: bot.username,
      owner_user_id: bot.userId,
      owner_telegram_id: tenantOwner?.telegramId ?? null,
      sheet_id: freeSheet.sheetId,
      admin_password: adminCode,
      status: "active",
      bot_purpose: bot.description ?? "",
      created_at: bot.createdAt,
    });

    syncBotUpsert({
      id: bot.id, userId: bot.userId, name: bot.name, username: bot.username,
      status: bot.status, commandCount: bot.commandCount, pluginCount: bot.pluginCount,
      userCount: bot.userCount, messageCount: bot.messageCount,
      createdAt: bot.createdAt, updatedAt: bot.updatedAt,
    });

    res.status(201).json(formatBot(bot));
  } catch (err) {
    logger.error({ err }, "Create trial bot error");
    res.status(500).json({ error: "خطا در فعال‌سازی تریال" });
  }
});

// ─── GET /api/payments/me ────────────────────────────────────────────────────
// Z3: tenant-facing invoice list (own payments only).

router.get("/payments/me", requireAuth, async (req: any, res) => {
  try {
    const rows = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.userId, req.userId))
      .orderBy(desc(paymentsTable.createdAt));

    const enriched = await Promise.all(
      rows.map(async (p) => {
        const [bot] = p.botId
          ? await db.select({ name: botsTable.name }).from(botsTable).where(eq(botsTable.id, p.botId)).limit(1)
          : [null];
        return {
          id: p.id,
          botId: p.botId,
          botName: bot?.name ?? null,
          amount: p.amount ?? null,
          receiptUrl: p.receiptUrl,
          description: p.description,
          status: p.status,
          reviewNote: p.reviewNote,
          createdAt: p.createdAt.toISOString(),
        };
      })
    );
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "List my payments error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/bots/wallet-purchase ──────────────────────────────────────────
// Z6: buy a bot paid directly from wallet balance (no receipt/pending review).
// Deducts the amount and creates an already-approved bot with an admin code.

router.post("/bots/wallet-purchase", requireAuth, async (req: any, res) => {
  try {
    const { name, token, description, amount, phone, telegramId, discountCode } = req.body;
    if (!name || !token) {
      res.status(400).json({ error: "Name and token are required" });
      return;
    }
    // فیلدهای اطلاعات تماس سفارش (صفحه‌ی تسویه‌حساب /bots/cart) — اجباری هستن
    // چون ممکنه با پروفایل کاربر فرق داشته باشن.
    if (!phone || !telegramId) {
      res.status(400).json({ error: "Phone and Telegram ID are required" });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    if (!user.telegramId) { res.status(400).json({ error: "Please link your Telegram account first" }); return; }

    if (await isTokenAlreadyUsed(token)) {
      res.status(409).json({ error: "This bot token is already registered", code: "duplicate_token" });
      return;
    }

    // Base price is still whatever the checkout flow sends (unchanged, pre-existing
    // behaviour — out of Phase 11's scope). What Phase 11 changes is that a discount
    // code is never trusted as a client-supplied final amount: it's re-validated and
    // the payable figure is recomputed from `price` here, inside the same transaction
    // that spends the wallet and records the code's use, so a code can't be replayed
    // past its maxUses by a race, and a client can't just send a smaller `amount`.
    const price = Number(amount) || 0;
    let finalAmount = price;
    let discountAmount = 0;
    let appliedCodeId: string | null = null;

    try {
      await db.transaction(async (tx: any) => {
        if (typeof discountCode === "string" && discountCode.trim()) {
          const applied = await applyDiscountCode(tx, discountCode, req.userId, price);
          finalAmount = applied.finalAmount;
          discountAmount = applied.discountAmount;
          appliedCodeId = applied.codeId;
        }
        const ok = await deductWallet(req.userId, finalAmount, `Bot purchase: ${name}`, tx);
        if (!ok) {
          // Roll back the whole transaction, including any discount-code redemption
          // already staged above — an order that can't be paid for never happened,
          // so it must not consume the code's usedCount.
          throw new InsufficientBalanceError();
        }
      });
    } catch (err) {
      if (err instanceof DiscountCodeError) {
        res.status(400).json({ error: err.message, code: err.reason });
        return;
      }
      if (err instanceof InsufficientBalanceError) {
        await createNotification({
          userId: req.userId,
          type: "purchase_failed",
          severity: "warning",
          title: "خرید بات ناموفق بود",
          message: `موجودی کیف پول برای خرید بات «${name}» به مبلغ ${formatTomanFa(finalAmount)} کافی نبود. کیف پول را شارژ کن و دوباره تلاش کن.`,
        });
        res.status(400).json({ error: "Insufficient wallet balance", code: "insufficient" });
        return;
      }
      throw err;
    }

    const botId = crypto.randomUUID();
    const adminCode = generateAdminCode();

    // best-effort sheet assignment (unlike receipt approval, this does not 503
    // when the pool is empty — the bot is created and a sheet can be assigned later)
    let sheetId: string | null = null;
    const [freeSheet] = await db.select().from(sheetPoolTable).where(eq(sheetPoolTable.status, "available")).limit(1);
    if (freeSheet) {
      await db.update(sheetPoolTable).set({ status: "assigned", assignedBotId: botId }).where(eq(sheetPoolTable.id, freeSheet.id));
      sheetId = freeSheet.sheetId;
    }

    const identity = await fetchBotIdentity(token);

    const [bot] = await db.insert(botsTable).values({
      id: botId, name, description: description ?? null, token: encryptToken(token),
      userId: req.userId, status: "inactive", paymentStatus: "approved", sheetId, adminCode,
      orderPhone: String(phone), orderTelegramId: String(telegramId),
      username: identity.username,
      avatarFileId: identity.avatarFileId,
      avatar: identity.avatarFileId ? `/api/bots/${botId}/avatar` : null,
    }).returning();

    await syncSheetTitle(sheetId, bot.name);

    await db.insert(activityTable).values({
      id: crypto.randomUUID(), userId: req.userId, type: "bot_created",
      title: "Bot purchased", description: `Bot "${name}" purchased from wallet`, botName: name,
    });

    if (user.telegramId) {
      await sendTelegramMessage(
        decryptToken(bot.token), user.telegramId,
        `✅ <b>بات شما فعال شد!</b>\n\n🤖 ${bot.name}\n🔑 کد ادمین: <code>${adminCode}</code>\n\nبرای فعال‌سازی پنل، این کد را وارد کنید.`
      );
    }

    await createNotification({
      userId: req.userId,
      botId: bot.id,
      type: "purchase_success",
      severity: "info",
      title: "خرید بات با موفقیت انجام شد",
      message: appliedCodeId
        ? `بات «${bot.name}» به مبلغ ${formatTomanFa(finalAmount)} (پس از ${formatTomanFa(discountAmount)} تخفیف با کد تخفیف) از کیف پول خریداری شد و آماده‌ی راه‌اندازی است. کد ادمین آن ${adminCode} است.`
        : `بات «${bot.name}» به مبلغ ${formatTomanFa(finalAmount)} از کیف پول خریداری شد و آماده‌ی راه‌اندازی است. کد ادمین آن ${adminCode} است.`,
    });

    res.status(201).json(formatBot(bot));
  } catch (err) {
    logger.error({ err }, "Wallet purchase bot error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/bots/pending-payments ─────────────────────────────────────────
// سوپرادمین — لیست فیش‌های منتظر بررسی

router.get("/bots/pending-payments", requireSuperAdmin, async (req: any, res) => {
  try {
    const payments = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.status, "pending"));

    // اطلاعات بات و کاربر رو هم attach کن
    const enriched = await Promise.all(
      payments.map(async (p) => {
        const [bot] = p.botId
          ? await db.select().from(botsTable).where(eq(botsTable.id, p.botId)).limit(1)
          : [null];
        const [user] = await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, p.userId))
          .limit(1);
        return {
          payment: {
            id: p.id,
            botId: p.botId,
            receiptUrl: p.receiptUrl,
            description: p.description,
            status: p.status,
            createdAt: p.createdAt.toISOString(),
          },
          bot: bot ? formatBot(bot) : null,
          user: user
            ? { id: user.id, name: user.name, email: user.email, telegramId: user.telegramId }
            : null,
        };
      })
    );

    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "Pending payments error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/bots/:botId/approve-payment ───────────────────────────────────
// FIX [Group 3]: سوپرادمین تأیید می‌کنه → شیت assign + adminCode + پیام تلگرام

router.post("/bots/:botId/approve-payment", requireSuperAdmin, async (req: any, res) => {
  try {
    const { reviewNote } = req.body;
    const { botId } = req.params;

    const [bot] = await db
      .select()
      .from(botsTable)
      .where(eq(botsTable.id, botId))
      .limit(1);

    if (!bot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }
    if (bot.paymentStatus === "approved") {
      res.status(400).json({ error: "Already approved" });
      return;
    }

    // ۱. یک شیت آزاد از Pool بگیر
    const [freeSheet] = await db
      .select()
      .from(sheetPoolTable)
      .where(eq(sheetPoolTable.status, "available"))
      .limit(1);

    if (!freeSheet) {
      res.status(503).json({
        error: "No available sheets in pool. Add more sheets via /api/sheet-pool",
      });
      return;
    }

    // ۲. شیت رو به این بات assign کن
    await db
      .update(sheetPoolTable)
      .set({ status: "assigned", assignedBotId: botId })
      .where(eq(sheetPoolTable.id, freeSheet.id));

    syncSheetPoolUpsert({
      sheet_id: freeSheet.sheetId,
      assigned_to: botId,
      used_by: decryptToken(bot.token),
      status: "assigned",
    });

    // ۳. admin code بساز
    const adminCode = generateAdminCode();

    // ۴. بات رو آپدیت کن
    const [updatedBot] = await db
      .update(botsTable)
      .set({
        status: "inactive",
        paymentStatus: "approved",
        sheetId: freeSheet.sheetId,
        adminCode,
      })
      .where(eq(botsTable.id, botId))
      .returning();

    // ۵. فیش رو هم آپدیت کن
    await db
      .update(paymentsTable)
      .set({ status: "approved", reviewedBy: req.userId, reviewNote: reviewNote ?? null })
      .where(eq(paymentsTable.botId, botId));

    await syncSheetTitle(freeSheet.sheetId, updatedBot.name);

    // ۶. Sync tenant (ربط توکن بات به شیت) — bot-compatible shape
    const [tenantOwner] = await db
      .select({ telegramId: usersTable.telegramId })
      .from(usersTable).where(eq(usersTable.id, updatedBot.userId)).limit(1);
    syncTenantUpsert({
      bot_token: decryptToken(updatedBot.token),
      bot_name: updatedBot.name,
      bot_username: updatedBot.username,
      owner_user_id: updatedBot.userId,
      owner_telegram_id: tenantOwner?.telegramId ?? null,
      sheet_id: freeSheet.sheetId,
      admin_password: adminCode,
      status: "active",
      created_at: updatedBot.createdAt,
    });

    syncBotUpsert({
      id: updatedBot.id, userId: updatedBot.userId, name: updatedBot.name,
      username: updatedBot.username, status: updatedBot.status,
      commandCount: updatedBot.commandCount, pluginCount: updatedBot.pluginCount,
      userCount: updatedBot.userCount, messageCount: updatedBot.messageCount,
      createdAt: updatedBot.createdAt, updatedAt: updatedBot.updatedAt,
    });

    // ۷. ارسال پیام از طریق خود بات به کاربر
    const [owner] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, updatedBot.userId))
      .limit(1);

    if (owner?.telegramId) {
      const plainToken = decryptToken(updatedBot.token);
      await sendTelegramMessage(
        plainToken,
        owner.telegramId,
        `✅ <b>بات شما تأیید شد!</b>\n\n` +
          `🤖 نام بات: ${updatedBot.name}\n` +
          `🔑 کد ادمین: <code>${adminCode}</code>\n\n` +
          `برای فعال‌سازی پنل بات، این کد را در پروفایل خود وارد کنید.`
      );
    }

    await createNotification({
      userId: updatedBot.userId,
      botId: updatedBot.id,
      type: "payment_approved",
      severity: "info",
      title: "فیش پرداخت تأیید شد",
      message: `فیش پرداخت بات «${updatedBot.name}» تأیید شد و بات فعال شد. کد ادمین آن ${adminCode} است.`
        + (reviewNote ? `\n\nیادداشت بررسی‌کننده: ${reviewNote}` : ""),
    });

    res.json({ success: true, bot: formatBot(updatedBot), adminCode });
  } catch (err) {
    logger.error({ err }, "Approve payment error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/bots/:botId/reject-payment ────────────────────────────────────

router.post("/bots/:botId/reject-payment", requireSuperAdmin, async (req: any, res) => {
  try {
    const { reviewNote } = req.body;
    const { botId } = req.params;

    // BUG FIX: check existence before updating
    const [existingBot] = await db
      .select()
      .from(botsTable)
      .where(eq(botsTable.id, botId))
      .limit(1);

    if (!existingBot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }

    const [updatedBot] = await db
      .update(botsTable)
      .set({ status: "payment_rejected", paymentStatus: "rejected" })
      .where(eq(botsTable.id, botId))
      .returning();

    await db
      .update(paymentsTable)
      .set({ status: "rejected", reviewedBy: req.userId, reviewNote: reviewNote ?? null })
      .where(eq(paymentsTable.botId, botId));

    syncBotUpsert({
      id: updatedBot.id, userId: updatedBot.userId, name: updatedBot.name,
      username: updatedBot.username, status: updatedBot.status,
      commandCount: updatedBot.commandCount, pluginCount: updatedBot.pluginCount,
      userCount: updatedBot.userCount, messageCount: updatedBot.messageCount,
      createdAt: updatedBot.createdAt, updatedAt: updatedBot.updatedAt,
    });

    await createNotification({
      userId: updatedBot.userId,
      botId: updatedBot.id,
      type: "payment_rejected",
      severity: "critical",
      title: "فیش پرداخت رد شد",
      message: `فیش پرداخت بات «${updatedBot.name}» تأیید نشد و سفارش فعال نشد.`
        + (reviewNote ? `\n\nدلیل: ${reviewNote}` : "")
        + `\n\nاگر فکر می‌کنی اشتباهی رخ داده، از بخش پشتیبانی تیکت بزن.`,
    });

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Reject payment error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/bots/pending-payments/:paymentId/cancel ───────────────────────
// سوپرادمین می‌تونه کل سفارش رو کنسل کنه، حتی اگه بات مرتبط حذف/گم شده باشه
// (مثلاً بات قبل از بررسی فیش پاک شده). برخلاف approve/reject که وابسته به
// وجود ردیف bot هستن، این route فقط رکورد payment رو کنسل می‌کنه.

router.post("/bots/pending-payments/:paymentId/cancel", requireSuperAdmin, async (req: any, res) => {
  try {
    const { reviewNote } = req.body;
    const { paymentId } = req.params;

    const [payment] = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.id, paymentId))
      .limit(1);

    if (!payment) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }
    if (payment.status !== "pending") {
      res.status(400).json({ error: "Payment already reviewed" });
      return;
    }

    await db
      .update(paymentsTable)
      .set({ status: "cancelled", reviewedBy: req.userId, reviewNote: reviewNote ?? null })
      .where(eq(paymentsTable.id, paymentId));

    // اگه بات مرتبط هنوز وجود داره، وضعیتش رو هم به‌روز کن (سفارش لغو شده)
    if (payment.botId) {
      const [bot] = await db
        .select()
        .from(botsTable)
        .where(eq(botsTable.id, payment.botId))
        .limit(1);

      if (bot) {
        const [updatedBot] = await db
          .update(botsTable)
          .set({ status: "payment_rejected", paymentStatus: "rejected" })
          .where(eq(botsTable.id, payment.botId))
          .returning();

        syncBotUpsert({
          id: updatedBot.id, userId: updatedBot.userId, name: updatedBot.name,
          username: updatedBot.username, status: updatedBot.status,
          commandCount: updatedBot.commandCount, pluginCount: updatedBot.pluginCount,
          userCount: updatedBot.userCount, messageCount: updatedBot.messageCount,
          createdAt: updatedBot.createdAt, updatedAt: updatedBot.updatedAt,
        });
      }
    }

    // نام بات ممکنه در دسترس نباشه (بات قبل از بررسی حذف شده) — در اون حالت
    // مبلغ سفارش رو به‌عنوان نشانه‌ی مشخصه توی متن می‌آریم.
    const cancelledBotName = payment.botId
      ? (await db.select({ name: botsTable.name }).from(botsTable).where(eq(botsTable.id, payment.botId)).limit(1))[0]?.name
      : undefined;
    const orderLabel = cancelledBotName
      ? `بات «${cancelledBotName}»`
      : payment.amount
        ? `سفارش ${formatTomanFa(payment.amount)}`
        : "سفارش شما";

    await createNotification({
      userId: payment.userId,
      botId: payment.botId ?? null,
      type: "order_cancelled",
      severity: "critical",
      title: "سفارش لغو شد",
      message: `${orderLabel} توسط پشتیبانی لغو شد.`
        + (reviewNote ? `\n\nدلیل: ${reviewNote}` : "")
        + `\n\nبرای پیگیری وجه پرداختی یا ثبت دوباره‌ی سفارش، از بخش پشتیبانی تیکت بزن.`,
    });

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Cancel payment error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/bots/activate-admin-code ──────────────────────────────────────
// FIX [Group 4]: کاربر admin code رو وارد می‌کنه → پنل بات فعال می‌شه
// Admin Code re-usable است (هر زمان می‌شه دوباره وارد کرد)

router.post("/bots/activate-admin-code", requireAuth, async (req: any, res) => {
  try {
    const { adminCode } = req.body;
    if (!adminCode) {
      res.status(400).json({ error: "Admin code is required" });
      return;
    }

    // پیدا کردن بات با این adminCode که متعلق به این کاربر باشه
    const [bot] = await db
      .select()
      .from(botsTable)
      .where(
        and(
          eq(botsTable.userId, req.userId),
          eq(botsTable.adminCode, adminCode.trim().toUpperCase()),
          eq(botsTable.paymentStatus, "approved")
        )
      )
      .limit(1);

    if (!bot) {
      res.status(404).json({ error: "Invalid admin code or bot not found" });
      return;
    }

    // Admin code معتبره → بات رو active کن (پنل فعال می‌شه)
    const [updatedBot] = await db
      .update(botsTable)
      .set({ status: "active" })
      .where(eq(botsTable.id, bot.id))
      .returning();

    syncBotUpsert({
      id: updatedBot.id, userId: updatedBot.userId, name: updatedBot.name,
      username: updatedBot.username, status: updatedBot.status,
      commandCount: updatedBot.commandCount, pluginCount: updatedBot.pluginCount,
      userCount: updatedBot.userCount, messageCount: updatedBot.messageCount,
      createdAt: updatedBot.createdAt, updatedAt: updatedBot.updatedAt,
    });

    res.json({ success: true, bot: formatBot(updatedBot) });
  } catch (err) {
    logger.error({ err }, "Activate admin code error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/sheet-pool ────────────────────────────────────────────────────
// FIX [Group 4]: سوپرادمین شیت‌های جدید به pool اضافه می‌کنه

router.post("/sheet-pool", requireSuperAdmin, async (req: any, res) => {
  try {
    const { sheetId } = req.body;
    if (!sheetId) {
      res.status(400).json({ error: "sheetId is required" });
      return;
    }

    const [entry] = await db
      .insert(sheetPoolTable)
      .values({
        id: crypto.randomUUID(),
        sheetId,
        status: "available",
        addedBy: req.userId,
      })
      .returning();

    syncSheetPoolUpsert({
      sheet_id: entry.sheetId,
      status: "available",
      assigned_to: null,
      created_at: entry.createdAt,
    });

    res.status(201).json({
      id: entry.id,
      sheetId: entry.sheetId,
      status: entry.status,
      createdAt: entry.createdAt.toISOString(),
    });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "This sheet ID already exists in the pool" });
      return;
    }
    logger.error({ err }, "Add sheet pool error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/sheet-pool ─────────────────────────────────────────────────────

router.get("/sheet-pool", requireSuperAdmin, async (req: any, res) => {
  try {
    const entries = await db.select().from(sheetPoolTable);

    const botIds = [...new Set(entries.map((e) => e.assignedBotId).filter((id): id is string => !!id))];
    const botsById = new Map<string, { name: string; userId: string }>();
    if (botIds.length > 0) {
      const rows = await db
        .select({ id: botsTable.id, name: botsTable.name, userId: botsTable.userId })
        .from(botsTable)
        .where(inArray(botsTable.id, botIds));
      for (const b of rows) botsById.set(b.id, { name: b.name, userId: b.userId });
    }

    res.json(
      entries.map((e) => ({
        id: e.id,
        sheetId: e.sheetId,
        status: e.status,
        assignedBotId: e.assignedBotId,
        assignedBotName: e.assignedBotId ? botsById.get(e.assignedBotId)?.name ?? null : null,
        assignedBotOwnerId: e.assignedBotId ? botsById.get(e.assignedBotId)?.userId ?? null : null,
        createdAt: e.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    logger.error({ err }, "List sheet pool error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/sheet-pool/:id/release ────────────────────────────────────────
// خالی‌کردن دستیِ یک شیت — صرف‌نظر از وضعیت فعلیش، status رو "available" و
// assignedBotId رو null می‌کنه. برای دیتای قدیمی/گیرکرده‌ای که هنوز assigned
// نشون داده می‌شه (مثلاً باتش قبل از این فیکس حذف شده) یا هر سناریوی دیگه‌ای
// که سوپرادمین بخواد بدون تغییر sheetId، صرفاً شیت رو دوباره در دسترس بذاره.
// برخلاف approve/reject-payment، این کاملاً مستقل از وجود بات مرتبطه.

router.post("/sheet-pool/:id/release", requireSuperAdmin, async (req: any, res) => {
  try {
    const { id } = req.params;

    const [entry] = await db.select().from(sheetPoolTable).where(eq(sheetPoolTable.id, id)).limit(1);
    if (!entry) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }

    const [updated] = await db
      .update(sheetPoolTable)
      .set({ status: "available", assignedBotId: null })
      .where(eq(sheetPoolTable.id, id))
      .returning();

    syncSheetPoolUpsert({ sheet_id: updated.sheetId, assigned_to: null, status: "available" });
    await markSheetTitleFreed(updated.sheetId);

    res.json({
      id: updated.id,
      sheetId: updated.sheetId,
      status: updated.status,
      assignedBotId: updated.assignedBotId,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Release sheet pool error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /api/sheet-pool/:id ──────────────────────────────────────────────
// سوپرادمین یک شیت رو از pool حذف می‌کنه. اگه شیت به یک بات اختصاص داده شده،
// حذف مستقیم بلاک می‌شه (چون بات همچنان به این sheetId رفرنس داره) — باید
// اول با /replace جایگزینش کنن یا بات مربوطه رو جدا/حذف کنن.

router.delete("/sheet-pool/:id", requireSuperAdmin, async (req: any, res) => {
  try {
    const { id } = req.params;

    const [entry] = await db.select().from(sheetPoolTable).where(eq(sheetPoolTable.id, id)).limit(1);
    if (!entry) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }
    if (entry.status === "assigned") {
      res.status(409).json({
        error: "Sheet is assigned to a bot. Replace it with another sheet instead of deleting.",
      });
      return;
    }

    await db.delete(sheetPoolTable).where(eq(sheetPoolTable.id, id));
    syncSheetPoolDelete(entry.sheetId);

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Delete sheet pool error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/sheet-pool/:id/replace ────────────────────────────────────────
// سوپرادمین یک شیت رو با یک sheetId دیگه جایگزین می‌کنه — هم برای شیت‌های
// آزاد (مثلاً شیت خراب/غیرقابل‌دسترس) و هم برای شیت‌های assigned. اگه assigned
// باشه، sheetId بات مرتبط هم آپدیت می‌شه و tenant registry دوباره sync می‌شه
// تا مین‌بات با شیت جدید کار کنه.

router.post("/sheet-pool/:id/replace", requireSuperAdmin, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { sheetId: newSheetId } = req.body ?? {};

    if (!newSheetId || typeof newSheetId !== "string" || !isValidSheetId(newSheetId.trim())) {
      res.status(400).json({ error: "A valid sheetId is required" });
      return;
    }
    const trimmedSheetId = newSheetId.trim();

    const [entry] = await db.select().from(sheetPoolTable).where(eq(sheetPoolTable.id, id)).limit(1);
    if (!entry) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }

    const oldSheetId = entry.sheetId;

    let updated;
    try {
      [updated] = await db
        .update(sheetPoolTable)
        .set({ sheetId: trimmedSheetId })
        .where(eq(sheetPoolTable.id, id))
        .returning();
    } catch (err: any) {
      if (err?.code === "23505") {
        res.status(409).json({ error: "This sheet ID already exists in the pool" });
        return;
      }
      throw err;
    }

    // اگه این ردیف به یک بات assign شده، sheetId بات و tenant registry رو هم آپدیت کن
    if (updated.assignedBotId) {
      const [bot] = await db.select().from(botsTable).where(eq(botsTable.id, updated.assignedBotId)).limit(1);
      if (bot) {
        await db.update(botsTable).set({ sheetId: trimmedSheetId }).where(eq(botsTable.id, bot.id));

        await syncSheetTitle(trimmedSheetId, bot.name);

        const [tenantOwner] = await db
          .select({ telegramId: usersTable.telegramId })
          .from(usersTable)
          .where(eq(usersTable.id, bot.userId))
          .limit(1);

        syncTenantUpsert({
          bot_token: decryptToken(bot.token),
          bot_name: bot.name,
          bot_username: bot.username,
          owner_user_id: bot.userId,
          owner_telegram_id: tenantOwner?.telegramId ?? null,
          sheet_id: trimmedSheetId,
          admin_password: bot.adminCode ?? "",
          status: bot.status,
          created_at: bot.createdAt,
        });

        syncSheetPoolUpsert({
          sheet_id: trimmedSheetId,
          assigned_to: bot.id,
          used_by: decryptToken(bot.token),
          status: "assigned",
        });
      }
    } else {
      syncSheetPoolUpsert({
        sheet_id: trimmedSheetId,
        assigned_to: null,
        status: "available",
      });
    }

    // ردیف قدیمی رو از رجیستری پاک کن (چون کلید بر اساس sheet_id هست، sheetId عوض شده یعنی کلید عوض شده)
    if (oldSheetId !== trimmedSheetId) {
      syncSheetPoolDelete(oldSheetId);
    }

    res.json({
      id: updated.id,
      sheetId: updated.sheetId,
      status: updated.status,
      assignedBotId: updated.assignedBotId,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Replace sheet pool error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/bots ─────────────────────────────────────────────────────
// R6: platform-wide list for the super-admin "All Bots" table. Every bot plus
// its owner {id,name,email}. Gated by requireSuperAdmin specifically (NOT the
// broader requireAdmin) because formatBot returns the decrypted Telegram token.

router.get("/admin/bots", requireSuperAdmin, async (req: any, res) => {
  try {
    const bots = await db.select().from(botsTable);
    const enriched = await Promise.all(
      bots.map(async (bot) => {
        const [owner] = await db
          .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
          .from(usersTable)
          .where(eq(usersTable.id, bot.userId))
          .limit(1);
        return { ...formatBot(bot), owner: owner ?? null };
      })
    );
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "Admin list bots error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/admin/bots ────────────────────────────────────────────────────
// R6: super-admin manual bot registration — for bots created directly with a
// Telegram token outside the normal receipt-payment flow (see دیالوگ "افزودن
// بات با توکن" in AllBotsTable.tsx). Assigns a free pool sheet automatically
// when one is available; otherwise the bot is created without one and a sheet
// can be attached later, same as /bots/wallet-purchase.

router.post("/admin/bots", requireSuperAdmin, async (req: any, res) => {
  try {
    const { name, token, ownerId, description } = req.body ?? {};
    if (!name?.trim() || !token?.trim() || !ownerId) {
      res.status(400).json({ error: "Name, token and ownerId are required" });
      return;
    }

    const [owner] = await db
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, ownerId))
      .limit(1);
    if (!owner) {
      res.status(404).json({ error: "Owner not found" });
      return;
    }

    // Tokens are encrypted with a random IV (no DB-level uniqueness possible),
    // so duplicate detection is done by decrypting existing rows in-app.
    if (await isTokenAlreadyUsed(token.trim())) {
      res.status(409).json({ error: "A bot with this token is already registered" });
      return;
    }

    const botId = crypto.randomUUID();

    let sheetId: string | null = null;
    const [freeSheet] = await db
      .select()
      .from(sheetPoolTable)
      .where(eq(sheetPoolTable.status, "available"))
      .limit(1);
    if (freeSheet) {
      await db
        .update(sheetPoolTable)
        .set({ status: "assigned", assignedBotId: botId })
        .where(eq(sheetPoolTable.id, freeSheet.id));
      sheetId = freeSheet.sheetId;
    }

    const adminCode = generateAdminCode();

    const [bot] = await db
      .insert(botsTable)
      .values({
        id: botId,
        name: name.trim(),
        description: description?.trim() || null,
        token: encryptToken(token.trim()),
        userId: ownerId,
        status: "active",
        paymentStatus: "approved",
        sheetId,
        adminCode,
      })
      .returning();

    await db.insert(activityTable).values({
      id: crypto.randomUUID(),
      userId: ownerId,
      type: "bot_created",
      title: "Bot added by admin",
      description: `Bot "${bot.name}" registered manually by an admin`,
      botName: bot.name,
    });

    await syncSheetTitle(sheetId, bot.name);

    syncBotUpsert({
      id: bot.id, userId: bot.userId, name: bot.name, username: bot.username,
      status: bot.status, commandCount: bot.commandCount, pluginCount: bot.pluginCount,
      userCount: bot.userCount, messageCount: bot.messageCount,
      createdAt: bot.createdAt, updatedAt: bot.updatedAt,
    });
    if (sheetId) {
      syncSheetPoolUpsert({
        sheet_id: sheetId,
        status: "assigned",
        assigned_to: bot.id,
        used_by: token.trim(),
        created_at: freeSheet!.createdAt,
      });
    }

    // BUG FIX: this used to be missing entirely, so admin-created bots never
    // landed in the registry `tenants` tab — the bot runtime reads bots from
    // there, not from Postgres, so the bot stayed effectively "off" even
    // though the site showed it as active. Same shape as the approve-payment
    // flow's syncTenantUpsert call below.
    const [tenantOwner] = await db
      .select({ telegramId: usersTable.telegramId })
      .from(usersTable)
      .where(eq(usersTable.id, ownerId))
      .limit(1);
    syncTenantUpsert({
      bot_token: token.trim(),
      bot_name: bot.name,
      bot_username: bot.username,
      owner_user_id: bot.userId,
      owner_telegram_id: tenantOwner?.telegramId ?? null,
      sheet_id: sheetId,
      admin_password: adminCode,
      status: "active",
      created_at: bot.createdAt,
    });

    res.status(201).json({ ...formatBot(bot), owner, sheetAssigned: Boolean(sheetId) });
  } catch (err) {
    logger.error({ err }, "Admin create bot error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /api/admin/bots/:botId ───────────────────────────────────────────
// R6: super-admin can remove any tenant's bot (not just their own), reusing
// the same full-purge cleanup as the tenant-facing DELETE /bots/:botId.

router.delete("/admin/bots/:botId", requireSuperAdmin, async (req: any, res) => {
  try {
    const [botToDelete] = await db
      .select()
      .from(botsTable)
      .where(eq(botsTable.id, req.params.botId))
      .limit(1);

    if (!botToDelete) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }

    await purgeBotFully(botToDelete, "manual");
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Admin delete bot error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/admin/bots/:botId/registry-status ──────────────────────────────
// Backs the "check status" button in the admin panel: bypasses the tenants
// cache and reports whether this bot actually has a row in the registry
// `tenants` tab, and whether that row's sheet/name match Postgres. A bot can
// look "active" in Postgres while being invisible to the bot runtime if this
// sync never happened (see the POST /admin/bots bug fix above).

router.get("/admin/bots/:botId/registry-status", requireSuperAdmin, async (req: any, res) => {
  try {
    const [bot] = await db.select().from(botsTable).where(eq(botsTable.id, req.params.botId)).limit(1);
    if (!bot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }

    const plainToken = decryptToken(bot.token);
    const spreadsheetId = registrySheetId();
    if (!spreadsheetId) {
      res.status(503).json({ error: "Registry spreadsheet is not configured" });
      return;
    }

    const tenants = await readAllTenants(true);
    const entry = tenants.find((t) => t.bot_token === plainToken) ?? null;

    const registrySheetIdValue = entry ? (entry.spreadsheet_id || entry.sheet_id || null) : null;
    const inRegistry = Boolean(entry);
    const sheetMatches = inRegistry && registrySheetIdValue === (bot.sheetId ?? null);
    const nameMatches = inRegistry && entry?.bot_name === bot.name;

    // Also check the bot's sheet_pool row: used_by must be this bot's actual
    // token, not e.g. a leftover Postgres bot id from before the shape fix.
    let poolMatches = true; // no sheet at all isn't a pool-sync problem by itself
    let poolEntry: { spreadsheet_id?: string; used_by?: string | null } | null = null;
    if (bot.sheetId) {
      poolEntry = await readKV(spreadsheetId, "sheet_pool", bot.sheetId);
      poolMatches = poolEntry?.used_by === plainToken;
    }

    const synced = inRegistry && sheetMatches && nameMatches && poolMatches;

    res.json({
      botId: bot.id,
      botName: bot.name,
      botSheetId: bot.sheetId ?? null,
      inRegistry,
      sheetMatches,
      nameMatches,
      poolMatches,
      synced,
      registryEntry: entry,
      poolEntry,
    });
  } catch (err) {
    logger.error({ err }, "Admin bot registry-status error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/admin/bots/:botId/resync ──────────────────────────────────────
// Re-pushes this bot's canonical Postgres record into the registry `tenants`
// tab — fixes the "has a sheet but isn't in tenants" case. If the bot has NO
// sheet at all yet (e.g. it was created back when the pool was empty), this
// also claims one free sheet from the pool first, so one click both attaches
// a sheet AND syncs the tenant row — the bot goes from fully unstarted to
// fully running.

router.post("/admin/bots/:botId/resync", requireSuperAdmin, async (req: any, res) => {
  try {
    let [bot] = await db.select().from(botsTable).where(eq(botsTable.id, req.params.botId)).limit(1);
    if (!bot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }

    let sheetJustAssigned = false;
    if (!bot.sheetId) {
      const [freeSheet] = await db
        .select()
        .from(sheetPoolTable)
        .where(eq(sheetPoolTable.status, "available"))
        .limit(1);
      if (freeSheet) {
        await db
          .update(sheetPoolTable)
          .set({ status: "assigned", assignedBotId: bot.id })
          .where(eq(sheetPoolTable.id, freeSheet.id));
        [bot] = await db
          .update(botsTable)
          .set({ sheetId: freeSheet.sheetId })
          .where(eq(botsTable.id, bot.id))
          .returning();
        syncSheetPoolUpsert({
          sheet_id: freeSheet.sheetId,
          status: "assigned",
          assigned_to: bot.id,
          used_by: decryptToken(bot.token),
          created_at: freeSheet.createdAt,
        });
        sheetJustAssigned = true;
      }
    } else {
      // Bot already had a sheet — re-push its sheet_pool row too, in case it
      // was written with the old (wrong) shape that used the Postgres bot id
      // as used_by instead of the bot's actual Telegram token.
      syncSheetPoolUpsert({
        sheet_id: bot.sheetId,
        status: "assigned",
        assigned_to: bot.id,
        used_by: decryptToken(bot.token),
      });
    }

    let adminCode = bot.adminCode;
    if (!adminCode) {
      adminCode = generateAdminCode();
      await db.update(botsTable).set({ adminCode }).where(eq(botsTable.id, bot.id));
    }

    await syncSheetTitle(bot.sheetId, bot.name);

    const [tenantOwner] = await db
      .select({ telegramId: usersTable.telegramId })
      .from(usersTable)
      .where(eq(usersTable.id, bot.userId))
      .limit(1);

    syncTenantUpsert({
      bot_token: decryptToken(bot.token),
      bot_name: bot.name,
      bot_username: bot.username,
      owner_user_id: bot.userId,
      owner_telegram_id: tenantOwner?.telegramId ?? null,
      sheet_id: bot.sheetId,
      admin_password: adminCode,
      status: bot.status,
      created_at: bot.createdAt,
    });

    // Both syncs above are fire-and-forget (background writes) — give them a
    // moment before the follow-up status check re-reads the sheets.
    await new Promise((r) => setTimeout(r, 1500));

    res.json({ ok: true, sheetAssigned: sheetJustAssigned, hasSheet: Boolean(bot.sheetId) });
  } catch (err) {
    logger.error({ err }, "Admin bot resync error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/bots/:botId ────────────────────────────────────────────────────

router.get("/bots/:botId", requireAuth, async (req: any, res) => {
  try {
    // R6: a super_admin may open any bot's workspace even if they don't own it.
    // Check role === "super_admin" SPECIFICALLY (not requireAdmin) since
    // formatBot decrypts and returns the Telegram token.
    const [requester] = await db
      .select({ role: usersTable.role, telegramId: usersTable.telegramId })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId))
      .limit(1);
    const isSuperAdmin = requester?.role === "super_admin";
    if (!isSuperAdmin) {
      await reconcileBotsFromRegistry(req.userId, requester?.telegramId ?? null);
    }

    const where = isSuperAdmin
      ? eq(botsTable.id, req.params.botId)
      : and(eq(botsTable.id, req.params.botId), eq(botsTable.userId, req.userId));

    const [bot] = await db.select().from(botsTable).where(where).limit(1);
    if (!bot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }
    const withIdentity = await backfillBotIdentityIfStale(bot);
    const evaluated = withIdentity.isTrial ? await evaluateBotTrial(withIdentity) : withIdentity;
    res.json(await formatBotWithLiveStats(evaluated));
  } catch (err) {
    logger.error({ err }, "Get bot error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/bots/:botId/language ───────────────────────────────────────────
// Per-bot language config, read from the bot's sheet (dev fallback otherwise).
router.get("/bots/:botId/language", requireAuth, async (req: any, res) => {
  try {
    const [bot] = await db
      .select({ id: botsTable.id })
      .from(botsTable)
      .where(and(eq(botsTable.id, req.params.botId), eq(botsTable.userId, req.userId)))
      .limit(1);
    if (!bot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }
    res.json(await getBotLanguage(bot.id));
  } catch (err) {
    logger.error({ err }, "Get bot language error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT /api/bots/:botId/language ───────────────────────────────────────────
// Save the bot's language config → sheet (for the runtime) + local fallback.
router.put("/bots/:botId/language", requireAuth, async (req: any, res) => {
  try {
    const [bot] = await db
      .select({ id: botsTable.id })
      .from(botsTable)
      .where(and(eq(botsTable.id, req.params.botId), eq(botsTable.userId, req.userId)))
      .limit(1);
    if (!bot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }
    const config = parseBotLanguageConfig(req.body);
    if (!config) {
      res.status(400).json({ error: "Invalid language configuration" });
      return;
    }
    await setBotLanguage(bot.id, config);
    res.json(config);
  } catch (err) {
    logger.error({ err }, "Set bot language error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PATCH /api/bots/:botId ──────────────────────────────────────────────────

router.patch("/bots/:botId", requireAuth, async (req: any, res) => {
  try {
    const { name, description, token } = req.body;
    const update: Record<string, any> = {};
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;
    if (token !== undefined) update.token = encryptToken(token);
    // BUG FIX: Drizzle crashes if SET has no fields
    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    const [bot] = await db
      .update(botsTable)
      .set(update)
      .where(and(eq(botsTable.id, req.params.botId), eq(botsTable.userId, req.userId)))
      .returning();
    if (!bot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }
    if (name !== undefined) {
      await syncSheetTitle(bot.sheetId, bot.name);
    }
    syncBotUpsert({
      id: bot.id, userId: bot.userId, name: bot.name, username: bot.username,
      status: bot.status, commandCount: bot.commandCount, pluginCount: bot.pluginCount,
      userCount: bot.userCount, messageCount: bot.messageCount,
      createdAt: bot.createdAt, updatedAt: bot.updatedAt,
    });
    res.json(formatBot(bot));
  } catch (err) {
    logger.error({ err }, "Update bot error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /api/bots/:botId ─────────────────────────────────────────────────

router.delete("/bots/:botId", requireAuth, async (req: any, res) => {
  try {
    // BUG FIX: verify ownership BEFORE deleting sub-records
    const [botToDelete] = await db
      .select()
      .from(botsTable)
      .where(and(eq(botsTable.id, req.params.botId), eq(botsTable.userId, req.userId)))
      .limit(1);

    if (!botToDelete) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }

    await purgeBotFully(botToDelete, "manual");
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Delete bot error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /internal/bots/:botId/purge ────────────────────────────────────────
// Internal-only route for mainbot to trigger a full purge when a tenant's
// subscription grace period fully expires (see docs/DELETION_POLICY.md).
// Protected by a shared secret header instead of the normal user session
// (`requireAuth`) — there is no logged-in user on this call, it's a
// service-to-service request from mainbot's scheduled expiry job.
// Mounted under this router (itself mounted at /api in app.ts), so the
// real path is `/api/internal/bots/:botId/purge` — mainbot's
// `WEBSITE_API_URL` should point at the site's base URL including `/api`
// (the same convention the frontend's `VITE_API_URL` + generated API client
// already use for every other route in this file).
router.post("/internal/bots/:botId/purge", async (req: any, res) => {
  const providedSecret = req.header("X-Internal-Secret");
  const expectedSecret = process.env.INTERNAL_PURGE_SECRET;

  if (!expectedSecret || providedSecret !== expectedSecret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const [bot] = await db
      .select()
      .from(botsTable)
      .where(eq(botsTable.id, req.params.botId))
      .limit(1);

    if (!bot) {
      // Idempotent by design: mainbot retries this call on the next cycle if
      // a previous attempt failed after already succeeding here (or raced
      // with a manual delete) — a safe 404/no-op, not a crash.
      res.status(404).json({ error: "Bot not found (already purged?)" });
      return;
    }

    await purgeBotFully(bot, "expiry");
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Internal purge error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PATCH /api/bots/:botId/status ──────────────────────────────────────────

router.patch("/bots/:botId/status", requireAuth, async (req: any, res) => {
  try {
    const { status } = req.body;
    if (!VALID_BOT_STATUSES.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_BOT_STATUSES.join(", ")}` });
      return;
    }
    const [bot] = await db
      .update(botsTable)
      .set({ status })
      .where(and(eq(botsTable.id, req.params.botId), eq(botsTable.userId, req.userId)))
      .returning();
    if (!bot) {
      res.status(404).json({ error: "Bot not found" });
      return;
    }
    await db.insert(activityTable).values({
      id: crypto.randomUUID(),
      userId: req.userId,
      type: "bot_deployed",
      title: status === "active" ? "Bot activated" : "Bot deactivated",
      description: `Bot "${bot.name}" is now ${status}`,
      botName: bot.name,
    });
    syncBotUpsert({
      id: bot.id, userId: bot.userId, name: bot.name, username: bot.username,
      status: bot.status, commandCount: bot.commandCount, pluginCount: bot.pluginCount,
      userCount: bot.userCount, messageCount: bot.messageCount,
      createdAt: bot.createdAt, updatedAt: bot.updatedAt,
    });
    // BUG FIX: this route used to only sync the "bots" data-mirror tab, never
    // the registry "tenants" tab — that's the tab mainbot's tenant_watcher
    // actually reads to decide which tenant bots should be running. So
    // clicking start/stop never changed anything mainbot could see, and the
    // tenant process just stayed running (or off) regardless of the toggle.
    if (bot.sheetId) {
      const [tenantOwner] = await db
        .select({ telegramId: usersTable.telegramId })
        .from(usersTable).where(eq(usersTable.id, bot.userId)).limit(1);
      syncTenantUpsert({
        bot_token: decryptToken(bot.token),
        bot_name: bot.name,
        bot_username: bot.username,
        owner_user_id: bot.userId,
        owner_telegram_id: tenantOwner?.telegramId ?? null,
        sheet_id: bot.sheetId,
        admin_password: bot.adminCode ?? "",
        status: bot.status,
        created_at: bot.createdAt,
      });
    }
    res.json(formatBot(bot));
  } catch (err) {
    logger.error({ err }, "Toggle bot status error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/bots/:botId/regenerate-admin-code ─────────────────────────────
// V3: tenant regenerates their bot's admin code from the Settings tab. The new
// code overwrites the stored one and is re-sent through the same Telegram
// channel used at approval, so the old code stops working immediately.

router.post("/bots/:botId/regenerate-admin-code", requireBotOwnership, async (req: any, res) => {
  try {
    const bot = req.bot;
    if (bot.paymentStatus !== "approved") {
      res.status(400).json({ error: "Admin code is only available after payment approval" });
      return;
    }

    const adminCode = generateAdminCode();
    const [updated] = await db
      .update(botsTable)
      .set({ adminCode })
      .where(eq(botsTable.id, bot.id))
      .returning();

    const [owner] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, bot.userId))
      .limit(1);

    if (owner?.telegramId) {
      await sendTelegramMessage(
        decryptToken(updated.token),
        owner.telegramId,
        `🔑 <b>کد ادمین جدید</b>\n\n` +
          `🤖 ${updated.name}\n` +
          `کد جدید: <code>${adminCode}</code>\n\n` +
          `کد قبلی دیگر معتبر نیست.`
      );
    }

    res.json({ success: true, adminCode });
  } catch (err) {
    logger.error({ err }, "Regenerate admin code error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── باقی routeها (stats, commands, plugins) بدون تغییر ─────────────────────

router.get("/bots/:botId/stats", requireBotOwnership, async (req: any, res) => {
  try {
    const [bot] = await db
      .select()
      .from(botsTable)
      .where(and(eq(botsTable.id, req.params.botId), eq(botsTable.userId, req.userId)))
      .limit(1);
    if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
    const commands = await db.select().from(commandsTable).where(eq(commandsTable.botId, bot.id));
    const plugins = await db.select().from(installedPluginsTable).where(eq(installedPluginsTable.botId, bot.id));
    const totalMessages = bot.messageCount;
    const basePerDay = Math.floor(totalMessages / 7);
    const messagesPerDay = Array.from({ length: 7 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - i));
      return { date: date.toISOString().split("T")[0], count: i === 6 ? totalMessages - basePerDay * 6 : basePerDay };
    });
    res.json({ botId: bot.id, messages: bot.messageCount, users: bot.userCount, commands: commands.length, plugins: plugins.length, uptime: bot.status === "active" ? 99.5 : 0, messagesPerDay });
  } catch (err) { logger.error({ err }, "Get bot stats error"); res.status(500).json({ error: "Internal server error" }); }
});

// ─── GET /api/bots/:botId/avatar ────────────────────────────────────────────
// Phase 7: server-side proxy for a bot's Telegram profile photo, mirroring
// GET /api/users/:id/telegram-photo in routes/users.ts. bots.avatarFileId
// only ever holds a Telegram file_id, never a downloadable URL — that URL
// embeds the bot's own token (`.../file/bot<TOKEN>/<path>`), so it's
// resolved fresh (file_path is short-lived) and streamed here instead of
// ever being persisted or sent to the browser. No auth: this is loaded from
// a plain <img> tag, same as any other public avatar.
router.get("/bots/:botId/avatar", async (req, res) => {
  try {
    const [bot] = await db
      .select({ token: botsTable.token, avatarFileId: botsTable.avatarFileId })
      .from(botsTable)
      .where(eq(botsTable.id, req.params.botId))
      .limit(1);
    if (!bot?.avatarFileId) {
      res.status(404).end();
      return;
    }

    const botToken = decryptToken(bot.token);
    const filePath = await getTelegramFilePath(botToken, bot.avatarFileId);
    if (!filePath) {
      res.status(404).end();
      return;
    }

    const fileRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
    if (!fileRes.ok || !fileRes.body) {
      res.status(502).end();
      return;
    }

    res.set("Content-Type", fileRes.headers.get("content-type") || "image/jpeg");
    res.set("Cache-Control", "private, max-age=3600");
    const buf = Buffer.from(await fileRes.arrayBuffer());
    res.send(buf);
  } catch (err) {
    logger.error({ err }, "Bot avatar proxy error");
    res.status(500).end();
  }
});

// ─── Telegram profile (real Bot API profile, distinct from the site's own
// bots.name/description — see bot-profile-feature-prompt.md for why these
// are kept separate and read live from Telegram instead of a DB column) ────

router.get("/bots/:botId/telegram-profile", requireBotOwnership, async (req: any, res) => {
  try {
    const token = decryptToken(req.bot.token);
    const [nameRes, descRes, shortDescRes] = await Promise.all([
      tgApi<{ name: string }>(token, "getMyName"),
      tgApi<{ description: string }>(token, "getMyDescription"),
      tgApi<{ short_description: string }>(token, "getMyShortDescription"),
    ]);
    res.json({
      name: nameRes.ok ? nameRes.result?.name ?? null : null,
      description: descRes.ok ? descRes.result?.description ?? null : null,
      shortDescription: shortDescRes.ok ? shortDescRes.result?.short_description ?? null : null,
    });
  } catch (err) {
    logger.error({ err }, "Get telegram profile error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/bots/:botId/telegram-profile", requireBotOwnership, async (req: any, res) => {
  try {
    const { name, description, shortDescription } = req.body ?? {};
    if (name === undefined && description === undefined && shortDescription === undefined) {
      res.status(400).json({ error: "At least one of name, description, shortDescription is required" });
      return;
    }
    const token = decryptToken(req.bot.token);
    const errors: string[] = [];

    if (name !== undefined) {
      const r = await tgApi(token, "setMyName", { name });
      if (!r.ok) errors.push(r.description ?? "setMyName failed");
    }
    if (description !== undefined) {
      const r = await tgApi(token, "setMyDescription", { description });
      if (!r.ok) errors.push(r.description ?? "setMyDescription failed");
    }
    if (shortDescription !== undefined) {
      const r = await tgApi(token, "setMyShortDescription", { short_description: shortDescription });
      if (!r.ok) errors.push(r.description ?? "setMyShortDescription failed");
    }

    if (errors.length > 0) {
      res.status(400).json({ error: errors.join("; ") });
      return;
    }

    // Phase 7: setMyName only changes the bot's display name, not its
    // @username — but re-fetch identity anyway (cheap, non-fatal) since it's
    // the same call that also picks up a profile photo set after creation.
    const identity = await fetchBotIdentity(token);
    if (identity.username || identity.avatarFileId) {
      const update: Record<string, any> = {};
      if (identity.username) update.username = identity.username;
      if (identity.avatarFileId) {
        update.avatarFileId = identity.avatarFileId;
        update.avatar = `/api/bots/${req.bot.id}/avatar`;
      }
      await db.update(botsTable).set(update).where(eq(botsTable.id, req.bot.id));
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Update telegram profile error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/bots/:botId/telegram-profile/photo", requireBotOwnership, async (req: any, res) => {
  try {
    const dataUrl = String(req.body?.photo ?? "");
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if (!match) {
      res.status(400).json({ error: "Invalid photo data URL" });
      return;
    }
    const [, mimeType, base64] = match;
    if (!mimeType.startsWith("image/")) {
      res.status(400).json({ error: "photo must be an image" });
      return;
    }
    const buffer = Buffer.from(base64, "base64");
    const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
    if (buffer.length > MAX_PHOTO_BYTES) {
      res.status(400).json({ error: "Photo is too large (max 5MB)" });
      return;
    }
    const token = decryptToken(req.bot.token);
    const result = await tgSetProfilePhoto(token, buffer, mimeType);
    if (!result.ok) {
      res.status(400).json({ error: result.description ?? "setMyProfilePhoto failed" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Set telegram profile photo error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/bots/:botId/telegram-profile/photo", requireBotOwnership, async (req: any, res) => {
  try {
    const token = decryptToken(req.bot.token);
    const result = await tgApi(token, "removeMyProfilePhoto");
    if (!result.ok) {
      res.status(400).json({ error: result.description ?? "removeMyProfilePhoto failed" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Remove telegram profile photo error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/bots/:botId/commands", requireBotOwnership, async (req: any, res) => {
  try {
    const cmds = await db.select().from(commandsTable).where(eq(commandsTable.botId, req.params.botId));
    res.json(cmds.map(c => ({ id: c.id, botId: c.botId, name: c.name, description: c.description, permission: c.permission, arguments: c.arguments, workflow: c.workflow, enabled: c.enabled, createdAt: c.createdAt.toISOString() })));
  } catch (err) { logger.error({ err }, "List commands error"); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/bots/:botId/commands", requireBotOwnership, async (req: any, res) => {
  try {
    const { name, description, permission, arguments: args, workflow } = req.body;
    const id = crypto.randomUUID();
    const [cmd] = await db.insert(commandsTable).values({ id, botId: req.params.botId, name, description: description ?? "", permission: permission ?? "all", arguments: args ?? [], workflow: workflow ?? null, enabled: true }).returning();
    await db.update(botsTable).set({ commandCount: sql`(SELECT COUNT(*) FROM commands WHERE bot_id = ${req.params.botId})` }).where(eq(botsTable.id, req.params.botId));
    res.status(201).json({ id: cmd.id, botId: cmd.botId, name: cmd.name, description: cmd.description, permission: cmd.permission, arguments: cmd.arguments, workflow: cmd.workflow, enabled: cmd.enabled, createdAt: cmd.createdAt.toISOString() });
  } catch (err) { logger.error({ err }, "Create command error"); res.status(500).json({ error: "Internal server error" }); }
});

router.patch("/bots/:botId/commands/:commandId", requireBotOwnership, async (req: any, res) => {
  try {
    const update: Record<string, any> = {};
    const { name, description, permission, arguments: args, workflow, enabled } = req.body;
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;
    if (permission !== undefined) update.permission = permission;
    if (args !== undefined) update.arguments = args;
    if (workflow !== undefined) update.workflow = workflow;
    if (enabled !== undefined) update.enabled = enabled;
    const [cmd] = await db.update(commandsTable).set(update).where(and(eq(commandsTable.id, req.params.commandId), eq(commandsTable.botId, req.params.botId))).returning();
    if (!cmd) { res.status(404).json({ error: "Command not found" }); return; }
    res.json({ id: cmd.id, botId: cmd.botId, name: cmd.name, description: cmd.description, permission: cmd.permission, arguments: cmd.arguments, workflow: cmd.workflow, enabled: cmd.enabled, createdAt: cmd.createdAt.toISOString() });
  } catch (err) { logger.error({ err }, "Update command error"); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/bots/:botId/commands/:commandId", requireBotOwnership, async (req: any, res) => {
  try {
    await db.delete(commandsTable).where(and(eq(commandsTable.id, req.params.commandId), eq(commandsTable.botId, req.params.botId)));
    await db.update(botsTable).set({ commandCount: sql`(SELECT COUNT(*) FROM commands WHERE bot_id = ${req.params.botId})` }).where(eq(botsTable.id, req.params.botId));
    res.status(204).end();
  } catch (err) { logger.error({ err }, "Delete command error"); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/bots/:botId/plugins", requireBotOwnership, async (req: any, res) => {
  try {
    const plugins = await db.select().from(installedPluginsTable).where(eq(installedPluginsTable.botId, req.params.botId));
    res.json(plugins.map(p => ({ id: p.id, botId: p.botId, marketplaceItemId: p.marketplaceItemId, name: p.name, version: p.version, enabled: p.enabled, installedAt: p.installedAt.toISOString() })));
  } catch (err) { logger.error({ err }, "List plugins error"); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/bots/:botId/plugins", requireBotOwnership, async (req: any, res) => {
  try {
    const { marketplaceItemId, payFromWallet } = req.body;
    if (!marketplaceItemId) { res.status(400).json({ error: "marketplaceItemId is required" }); return; }
    const [item] = await db.select().from(marketplaceItemsTable).where(eq(marketplaceItemsTable.id, marketplaceItemId)).limit(1);
    if (!item) { res.status(404).json({ error: "Marketplace item not found" }); return; }
    // Z6: cart checkout can pay from wallet. Charge the item's real (server-side)
    // price so the client can't understate it.
    if (payFromWallet && !item.isFree && item.price > 0) {
      const ok = await deductWallet(req.userId, item.price, `Plugin: ${item.name}`);
      if (!ok) { res.status(400).json({ error: "Insufficient wallet balance", code: "insufficient" }); return; }
    }
    const id = crypto.randomUUID();
    const [plugin] = await db.insert(installedPluginsTable).values({ id, botId: req.params.botId, marketplaceItemId, name: item.name, version: item.version, enabled: true }).returning();

    const pricePart = item.isFree || item.price <= 0 ? "رایگان" : formatTomanFa(item.price);
    await createNotification({
      userId: req.userId,
      botId: req.params.botId,
      type: "plugin_purchased",
      severity: "info",
      title: "افزونه نصب شد",
      message: `افزونه‌ی «${item.name}» (نسخه ${item.version}) روی بات «${req.bot?.name ?? ""}» نصب شد — ${pricePart}.`,
    });

    res.status(201).json({ id: plugin.id, botId: plugin.botId, marketplaceItemId: plugin.marketplaceItemId, name: plugin.name, version: plugin.version, enabled: plugin.enabled, installedAt: plugin.installedAt.toISOString() });
  } catch (err) { logger.error({ err }, "Install plugin error"); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/bots/:botId/plugins/:pluginId", requireBotOwnership, async (req: any, res) => {
  try {
    await db.delete(installedPluginsTable).where(and(eq(installedPluginsTable.id, req.params.pluginId), eq(installedPluginsTable.botId, req.params.botId)));
    res.status(204).end();
  } catch (err) { logger.error({ err }, "Uninstall plugin error"); res.status(500).json({ error: "Internal server error" }); }
});

// ─── POST /api/bots/:botId/sheet — register/replace this bot's Google Sheet ───
// The customer supplies their own Spreadsheet ID; the auto-purchase bot then
// picks it up. Mirrors the main bot's onboarding (utils/bot_manager + sheets_
// manager.rename_spreadsheet + registry.register_tenant): validate access,
// rename the file "IrForge — <name>", set bots.sheetId, and register the
// token→sheet mapping in the registry `tenants` tab so the runtime reads it.
router.post("/bots/:botId/sheet", requireBotOwnership, async (req: any, res) => {
  try {
    const bot = req.bot;
    const sheetId = String(req.body?.sheetId ?? "").trim();
    if (!isValidSheetId(sheetId)) {
      res.status(400).json({ error: "شناسه شیت نامعتبر است. فقط ID خودِ Spreadsheet را وارد کنید (نه لینک کامل)." });
      return;
    }

    // 1. The service account must be able to open it (share it as Editor first).
    if (!(await sheetIsAccessible(sheetId))) {
      res.status(422).json({
        error: "به این شیت دسترسی نداریم. لطفاً شیت را با ایمیل سرویس‌اکانت به‌عنوان Editor به اشتراک بگذارید و دوباره تلاش کنید.",
        code: "no_access",
      });
      return;
    }

    // 2. Guard against hijacking a sheet already assigned to a different bot.
    const [claimed] = await db
      .select()
      .from(sheetPoolTable)
      .where(and(eq(sheetPoolTable.sheetId, sheetId), eq(sheetPoolTable.status, "assigned")))
      .limit(1);
    if (claimed && claimed.assignedBotId && claimed.assignedBotId !== bot.id) {
      res.status(409).json({ error: "این شیت قبلاً به بات دیگری اختصاص داده شده است." });
      return;
    }

    const previousSheetId: string | null = bot.sheetId ?? null;

    // 3. Rename the spreadsheet to match the bot (best-effort — don't fail the
    //    whole request if the title can't be changed).
    await syncSheetTitle(sheetId, bot.name);

    // 4. Point the bot at the new sheet.
    const [updatedBot] = await db
      .update(botsTable)
      .set({ sheetId })
      .where(eq(botsTable.id, bot.id))
      .returning();

    // 5. Pool bookkeeping: mark the new sheet assigned, free the old one.
    const [existingPool] = await db
      .select().from(sheetPoolTable).where(eq(sheetPoolTable.sheetId, sheetId)).limit(1);
    if (existingPool) {
      await db.update(sheetPoolTable)
        .set({ status: "assigned", assignedBotId: bot.id })
        .where(eq(sheetPoolTable.id, existingPool.id));
    } else {
      await db.insert(sheetPoolTable).values({
        id: crypto.randomUUID(), sheetId, status: "assigned", assignedBotId: bot.id, addedBy: req.userId,
      });
    }
    syncSheetPoolUpsert({ sheet_id: sheetId, assigned_to: bot.id, used_by: decryptToken(updatedBot.token), status: "assigned" });

    if (previousSheetId && previousSheetId !== sheetId) {
      await db.update(sheetPoolTable)
        .set({ status: "available", assignedBotId: null })
        .where(eq(sheetPoolTable.sheetId, previousSheetId));
      syncSheetPoolUpsert({ sheet_id: previousSheetId, assigned_to: null, status: "available" });
    }

    // 6. Register the token→sheet mapping so the bot runtime picks it up.
    const [sheetOwner] = await db
      .select({ telegramId: usersTable.telegramId })
      .from(usersTable).where(eq(usersTable.id, updatedBot.userId)).limit(1);
    syncTenantUpsert({
      bot_token: decryptToken(updatedBot.token),
      bot_name: updatedBot.name,
      bot_username: updatedBot.username,
      owner_user_id: updatedBot.userId,
      owner_telegram_id: sheetOwner?.telegramId ?? null,
      sheet_id: sheetId,
      admin_password: updatedBot.adminCode ?? "",
      status: "active",
      created_at: updatedBot.createdAt,
    });
    syncBotUpsert({
      id: updatedBot.id, userId: updatedBot.userId, name: updatedBot.name,
      username: updatedBot.username, status: updatedBot.status,
      commandCount: updatedBot.commandCount, pluginCount: updatedBot.pluginCount,
      userCount: updatedBot.userCount, messageCount: updatedBot.messageCount,
      createdAt: updatedBot.createdAt, updatedAt: updatedBot.updatedAt,
    });

    res.json({ success: true, bot: formatBot(updatedBot) });
  } catch (err) {
    logger.error({ err }, "Register bot sheet error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
