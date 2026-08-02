/**
 * sheetsSync.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Syncs every write-operation to Google Sheets in background (fire-and-forget).
 * All failures are logged but never bubble up — Postgres is source of truth.
 *
 * Sheet layout — key/value format (matching IrForge Registry style):
 *
 *   SHEETS_DATA_ID  (one spreadsheet, multiple tabs)
 *     tab "users"        → A: key (user id),  B: value (JSON)
 *     tab "bots"         → A: key (bot id),   B: value (JSON)
 *     tab "orders"       → A: key (order id), B: value (JSON)
 *     tab "sessions"     → A: key (token),    B: value (JSON)
 *     tab "admins"       → A: key (user id),  B: value (JSON)
 *     tab "bot_settings" → A: key (bot id),   B: value (JSON)
 *     tab "panels"       → A: key (panel id), B: value (JSON)
 *     tab "forms"        → A: key (form id),  B: value (JSON)
 *     tab "discounts"    → A: key (code),     B: value (JSON)
 *     tab "payments"     → A: key (pay id),   B: value (JSON)
 *     tab "referrals"    → A: key (user id),  B: value (JSON)
 *     tab "promos"       → A: key (promo id), B: value (JSON)
 *     tab "support"      → A: key (ticket id),B: value (JSON)
 *
 *   SHEETS_REGISTRY_ID  (bot registry)
 *     tab "tenants"    → A: key (bot_token),  B: value (JSON)
 *     tab "sheet_pool" → A: key (sheet_id),   B: value (JSON)
 *
 *   deletion_queue is NOT a key/value tab like the ones above — it's an
 *   append-only coordination queue (see docs/DELETION_POLICY.md) consumed
 *   by mainbot's periodic deletion worker:
 *     tab "deletion_queue" → A: bot_token, B: tenant_sheet_id,
 *                            C: requested_by (manual|expiry), D: requested_at,
 *                            E: status (pending|done|failed)
 */

import { appendSheet, readSheet, writeSheet, clearSheet, listTabs, addTab } from "./sheets.js";
import { logger } from "./logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────

type KVRow = [string, string]; // [key, JSON-stringified value]

// ─── Internal helpers ────────────────────────────────────────────────────────

function dataSheetId(): string | null {
  // SHEETS_DATA_ID is a separate, unrelated business-data mirror spreadsheet
  // (Postgres is the source of truth for it) — out of scope for the
  // registry-name unification, so no second name/fallback here. See
  // docs/DATA_UNIFICATION.md.
  return process.env.SHEETS_DATA_ID ?? null;
}

/**
 * Resolve the shared registry spreadsheet id. Reads the unified name first
 * (`REGISTRY_SPREADSHEET_ID`, matching mainbot/support-bot), falling back to
 * the legacy web-only name (`SHEETS_REGISTRY_ID`) so nothing breaks if
 * Railway hasn't been updated yet. Exported so any other module that needs
 * the registry sheet id (e.g. routes/database.ts) resolves it the same way
 * instead of re-reading `SHEETS_REGISTRY_ID` directly.
 */
export function registrySheetId(): string | null {
  return process.env.REGISTRY_SPREADSHEET_ID || process.env.SHEETS_REGISTRY_ID || null;
}

/** Ensure header row [key, value] exists on a tab. */
async function ensureHeader(spreadsheetId: string, tab: string) {
  try {
    const rows = await readSheet(spreadsheetId, `${tab}!A1:B1`);
    if (!rows || rows.length === 0 || rows[0]?.[0] !== "key") {
      await writeSheet(spreadsheetId, `${tab}!A1`, [["key", "value"]]);
    }
  } catch {
    try {
      await writeSheet(spreadsheetId, `${tab}!A1`, [["key", "value"]]);
    } catch { /* give up silently */ }
  }
}

/** Find the row number (1-based) of a record by key in column A. Returns -1 if not found. */
async function findRowByKey(spreadsheetId: string, tab: string, key: string): Promise<number> {
  try {
    const rows = await readSheet(spreadsheetId, `${tab}!A:A`);
    for (let i = 1; i < rows.length; i++) { // skip header at index 0
      if (rows[i]?.[0] === key) return i + 1; // 1-based
    }
  } catch { /* not found */ }
  return -1;
}

/** Upsert a key-value row on a tab. */
async function upsertKV(spreadsheetId: string, tab: string, key: string, value: object) {
  await ensureHeader(spreadsheetId, tab);
  const jsonValue = JSON.stringify(value);
  const row: KVRow = [key, jsonValue];
  const rowNum = await findRowByKey(spreadsheetId, tab, key);
  if (rowNum > 0) {
    await writeSheet(spreadsheetId, `${tab}!A${rowNum}`, [row]);
  } else {
    await appendSheet(spreadsheetId, tab, [row]);
  }
}

/** Delete a row by key (read-filter-rewrite). */
async function deleteKVByKey(spreadsheetId: string, tab: string, key: string) {
  const rows = await readSheet(spreadsheetId, tab);
  if (!rows || rows.length <= 1) return;
  const filtered = rows.filter((r, i) => i === 0 || r[0] !== key);
  await clearSheet(spreadsheetId, tab);
  if (filtered.length > 0) {
    await writeSheet(spreadsheetId, `${tab}!A1`, filtered);
  }
}

/** Read a single value by key from a tab. Returns parsed object or null. */
export async function readKV<T = Record<string, unknown>>(
  spreadsheetId: string,
  tab: string,
  key: string
): Promise<T | null> {
  try {
    const rows = await readSheet(spreadsheetId, `${tab}!A:B`);
    for (let i = 1; i < rows.length; i++) {
      if (rows[i]?.[0] === key) {
        return JSON.parse(rows[i][1]) as T;
      }
    }
  } catch { /* not found */ }
  return null;
}

/** Read all values from a tab. Returns array of parsed objects. */
export async function readAllKV<T = Record<string, unknown>>(
  spreadsheetId: string,
  tab: string
): Promise<T[]> {
  try {
    const rows = await readSheet(spreadsheetId, `${tab}!A:B`);
    const results: T[] = [];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i]?.[1]) {
        try { results.push(JSON.parse(rows[i][1]) as T); } catch { /* skip bad rows */ }
      }
    }
    return results;
  } catch { return []; }
}

/** Fire-and-forget wrapper — never throws. */
function bg(fn: () => Promise<void>, label: string) {
  fn().catch((err) => logger.warn({ err }, `sheetsSync [${label}] failed (non-fatal)`));
}

// ─── Public API — DATA sheet ─────────────────────────────────────────────────

// ── USERS ──────────────────────────────────────────────────────────────────

export function syncUserUpsert(user: {
  id: string; name: string; email: string; role: string; plan: string;
  status: string; bio?: string | null; telegramUsername?: string | null;
  createdAt: Date | string; updatedAt?: Date | string | null;
}) {
  const spreadsheetId = dataSheetId();
  if (!spreadsheetId) return;
  bg(async () => {
    await upsertKV(spreadsheetId, "users", user.id, {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      plan: user.plan,
      status: user.status,
      bio: user.bio ?? null,
      telegramUsername: user.telegramUsername ?? null,
      createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : (user.createdAt ?? ""),
      updatedAt: user.updatedAt instanceof Date ? (user.updatedAt as Date).toISOString() : (user.updatedAt ?? new Date().toISOString()),
    });
  }, `user-upsert:${user.id}`);
}

export function syncUserDelete(userId: string) {
  const spreadsheetId = dataSheetId();
  if (!spreadsheetId) return;
  bg(() => deleteKVByKey(spreadsheetId, "users", userId), `user-delete:${userId}`);
}

// ── BOTS ───────────────────────────────────────────────────────────────────

export function syncBotUpsert(bot: {
  id: string; userId: string; name: string; username?: string | null;
  status: string; commandCount: number; pluginCount: number;
  userCount: number; messageCount: number;
  createdAt: Date | string; updatedAt?: Date | string | null;
}) {
  const spreadsheetId = dataSheetId();
  if (!spreadsheetId) return;
  bg(async () => {
    await upsertKV(spreadsheetId, "bots", bot.id, {
      id: bot.id,
      userId: bot.userId,
      name: bot.name,
      username: bot.username ?? null,
      status: bot.status,
      commandCount: bot.commandCount,
      pluginCount: bot.pluginCount,
      userCount: bot.userCount,
      messageCount: bot.messageCount,
      createdAt: bot.createdAt instanceof Date ? bot.createdAt.toISOString() : (bot.createdAt ?? ""),
      updatedAt: bot.updatedAt instanceof Date ? (bot.updatedAt as Date).toISOString() : (bot.updatedAt ?? new Date().toISOString()),
    });
  }, `bot-upsert:${bot.id}`);
}

export function syncBotDelete(botId: string) {
  const spreadsheetId = dataSheetId();
  if (!spreadsheetId) return;
  bg(() => deleteKVByKey(spreadsheetId, "bots", botId), `bot-delete:${botId}`);
}

// ── ORDERS / PLANS ─────────────────────────────────────────────────────────

export function syncOrderUpsert(order: {
  id: string; userId: string; planId: string; planName: string;
  status: string; expiresAt?: Date | string | null; renewsAt?: Date | string | null;
  createdAt: Date | string;
}) {
  const spreadsheetId = dataSheetId();
  if (!spreadsheetId) return;
  bg(async () => {
    await upsertKV(spreadsheetId, "orders", order.id, {
      id: order.id,
      userId: order.userId,
      planId: order.planId,
      planName: order.planName,
      status: order.status,
      expiresAt: order.expiresAt instanceof Date ? order.expiresAt.toISOString() : (order.expiresAt ?? null),
      renewsAt: order.renewsAt instanceof Date ? order.renewsAt.toISOString() : (order.renewsAt ?? null),
      createdAt: order.createdAt instanceof Date ? order.createdAt.toISOString() : (order.createdAt ?? ""),
    });
  }, `order-upsert:${order.id}`);
}

// ── SESSIONS ───────────────────────────────────────────────────────────────

export function syncSessionUpsert(session: {
  token: string; userId: string; expiresAt: Date | string; createdAt?: Date | string;
}) {
  const spreadsheetId = dataSheetId();
  if (!spreadsheetId) return;
  bg(async () => {
    await upsertKV(spreadsheetId, "sessions", session.token, {
      token: session.token,
      userId: session.userId,
      expiresAt: session.expiresAt instanceof Date ? session.expiresAt.toISOString() : session.expiresAt,
      createdAt: session.createdAt instanceof Date ? (session.createdAt as Date).toISOString() : (session.createdAt ?? new Date().toISOString()),
    });
  }, `session-upsert:${session.userId}`);
}

export function syncSessionDelete(token: string) {
  const spreadsheetId = dataSheetId();
  if (!spreadsheetId) return;
  bg(() => deleteKVByKey(spreadsheetId, "sessions", token), `session-delete`);
}

// ── ADMINS ─────────────────────────────────────────────────────────────────

export function syncAdminUpsert(admin: {
  id: string; name: string; email: string; role: string;
  createdAt?: Date | string;
}) {
  const spreadsheetId = dataSheetId();
  if (!spreadsheetId) return;
  bg(async () => {
    await upsertKV(spreadsheetId, "admins", admin.id, {
      ...admin,
      createdAt: admin.createdAt instanceof Date ? admin.createdAt.toISOString() : (admin.createdAt ?? new Date().toISOString()),
    });
  }, `admin-upsert:${admin.id}`);
}

// ── PAYMENTS ───────────────────────────────────────────────────────────────

export function syncPaymentUpsert(payment: {
  id: string; userId: string; amount: number; status: string;
  planId?: string | null; createdAt: Date | string;
}) {
  const spreadsheetId = dataSheetId();
  if (!spreadsheetId) return;
  bg(async () => {
    await upsertKV(spreadsheetId, "payments", payment.id, {
      ...payment,
      createdAt: payment.createdAt instanceof Date ? payment.createdAt.toISOString() : payment.createdAt,
    });
  }, `payment-upsert:${payment.id}`);
}

// ── DISCOUNTS ──────────────────────────────────────────────────────────────

export function syncDiscountUpsert(discount: {
  code: string; type: string; value: number; maxUses?: number | null;
  usedCount?: number; expiresAt?: Date | string | null; createdAt: Date | string;
}) {
  const spreadsheetId = dataSheetId();
  if (!spreadsheetId) return;
  bg(async () => {
    await upsertKV(spreadsheetId, "discounts", discount.code, {
      ...discount,
      expiresAt: discount.expiresAt instanceof Date ? discount.expiresAt.toISOString() : (discount.expiresAt ?? null),
      createdAt: discount.createdAt instanceof Date ? discount.createdAt.toISOString() : discount.createdAt,
    });
  }, `discount-upsert:${discount.code}`);
}

export function syncDiscountDelete(code: string) {
  const spreadsheetId = dataSheetId();
  if (!spreadsheetId) return;
  bg(() => deleteKVByKey(spreadsheetId, "discounts", code), `discount-delete:${code}`);
}

// ── REFERRALS ──────────────────────────────────────────────────────────────

export function syncReferralUpsert(referral: {
  userId: string; referredBy?: string | null; code: string;
  count?: number; createdAt: Date | string;
}) {
  const spreadsheetId = dataSheetId();
  if (!spreadsheetId) return;
  bg(async () => {
    await upsertKV(spreadsheetId, "referrals", referral.userId, {
      ...referral,
      createdAt: referral.createdAt instanceof Date ? referral.createdAt.toISOString() : referral.createdAt,
    });
  }, `referral-upsert:${referral.userId}`);
}

// ── PROMOS ─────────────────────────────────────────────────────────────────

export function syncPromoUpsert(promo: {
  id: string; title: string; type: string; value: number;
  createdAt: Date | string;
}) {
  const spreadsheetId = dataSheetId();
  if (!spreadsheetId) return;
  bg(async () => {
    await upsertKV(spreadsheetId, "promos", promo.id, {
      ...promo,
      createdAt: promo.createdAt instanceof Date ? promo.createdAt.toISOString() : promo.createdAt,
    });
  }, `promo-upsert:${promo.id}`);
}

// ── SUPPORT TICKETS ────────────────────────────────────────────────────────

export function syncSupportUpsert(ticket: {
  id: string; userId: string; subject: string; status: string;
  createdAt: Date | string;
}) {
  const spreadsheetId = dataSheetId();
  if (!spreadsheetId) return;
  bg(async () => {
    await upsertKV(spreadsheetId, "support", ticket.id, {
      ...ticket,
      createdAt: ticket.createdAt instanceof Date ? ticket.createdAt.toISOString() : ticket.createdAt,
    });
  }, `support-upsert:${ticket.id}`);
}

// ── PANELS ─────────────────────────────────────────────────────────────────

export function syncPanelUpsert(panel: {
  id: string; botId: string; name: string; type: string;
  createdAt: Date | string;
}) {
  const spreadsheetId = dataSheetId();
  if (!spreadsheetId) return;
  bg(async () => {
    await upsertKV(spreadsheetId, "panels", panel.id, {
      ...panel,
      createdAt: panel.createdAt instanceof Date ? panel.createdAt.toISOString() : panel.createdAt,
    });
  }, `panel-upsert:${panel.id}`);
}

// ── FORMS ──────────────────────────────────────────────────────────────────

export function syncFormUpsert(form: {
  id: string; botId: string; name: string;
  createdAt: Date | string;
}) {
  const spreadsheetId = dataSheetId();
  if (!spreadsheetId) return;
  bg(async () => {
    await upsertKV(spreadsheetId, "forms", form.id, {
      ...form,
      createdAt: form.createdAt instanceof Date ? form.createdAt.toISOString() : form.createdAt,
    });
  }, `form-upsert:${form.id}`);
}

// ── BOT SETTINGS ───────────────────────────────────────────────────────────

export function syncBotSettingsUpsert(settings: {
  botId: string; [key: string]: unknown;
}) {
  const spreadsheetId = dataSheetId();
  if (!spreadsheetId) return;
  bg(async () => {
    await upsertKV(spreadsheetId, "bot_settings", settings.botId, settings);
  }, `bot-settings-upsert:${settings.botId}`);
}

// ─── Public API — REGISTRY sheet ─────────────────────────────────────────────

// ── TENANTS (bot token → bot info) ─────────────────────────────────────────

export function syncTenantUpsert(tenant: {
  bot_token: string; bot_name: string; bot_username?: string | null;
  owner_user_id: string;                 // the site account id
  owner_telegram_id?: string | null;     // the owner's Telegram id — what the bots DM on
  sheet_id?: string | null;
  admin_password?: string | null;
  status?: string;
  bot_purpose?: string | null;
  created_at?: Date | string;
}) {
  const spreadsheetId = registrySheetId();
  if (!spreadsheetId) return;
  bg(async () => {
    const sheet = tenant.sheet_id ?? "";
    // Write the EXACT field names the main bot's utils/registry.py reads
    // (`spreadsheet_id`, `owner_id`, `admin_password`, `status`, `bot_purpose`)
    // so a tenant registered from the site is picked up by the bot runtime —
    // plus the older site aliases for backward compatibility. One shared row.
    await upsertKV(spreadsheetId, "tenants", tenant.bot_token, {
      bot_token: tenant.bot_token,
      bot_name: tenant.bot_name,
      bot_username: tenant.bot_username ?? null,
      spreadsheet_id: sheet,
      owner_id: tenant.owner_telegram_id ?? tenant.owner_user_id,
      admin_password: tenant.admin_password ?? "",
      status: tenant.status ?? "active",
      bot_purpose: tenant.bot_purpose ?? "",
      // legacy aliases (kept so nothing that read the old shape breaks)
      sheet_id: sheet,
      owner_user_id: tenant.owner_user_id,
      created_at: tenant.created_at instanceof Date ? tenant.created_at.toISOString() : (tenant.created_at ?? new Date().toISOString()),
    });
  }, `tenant-upsert:${tenant.owner_user_id}`);
}

export function syncTenantDelete(botToken: string) {
  const spreadsheetId = registrySheetId();
  if (!spreadsheetId) return;
  bg(() => deleteKVByKey(spreadsheetId, "tenants", botToken), `tenant-delete`);
}

// ── SHEET POOL ─────────────────────────────────────────────────────────────

export function syncSheetPoolUpsert(entry: {
  sheet_id: string;
  assigned_to?: string | null; // Postgres bot id — website-only bookkeeping alias
  used_by?: string | null;     // the bot's own Telegram token — what mainbot actually reads/writes
  status: "free" | "available" | "assigned";
  created_at?: Date | string;
}) {
  const spreadsheetId = registrySheetId();
  if (!spreadsheetId) return;
  bg(async () => {
    // The main bot reads `{spreadsheet_id, used_by}` (used_by truthy = taken)
    // and — critically — expects used_by to be the bot's own Telegram token,
    // the same shape it writes itself when a tenant is created directly
    // through the bot. Passing a Postgres bot id here instead breaks that
    // contract (row looks "taken" to a truthy check, but any code that reads
    // used_by as a token — e.g. reverse lookup — won't find a match).
    const usedBy = entry.status === "assigned" ? (entry.used_by ?? null) : null;
    await upsertKV(spreadsheetId, "sheet_pool", entry.sheet_id, {
      spreadsheet_id: entry.sheet_id,
      used_by: usedBy,
      // legacy aliases
      sheet_id: entry.sheet_id,
      assigned_to: entry.assigned_to ?? null,
      status: entry.status,
      created_at: entry.created_at instanceof Date ? entry.created_at.toISOString() : (entry.created_at ?? new Date().toISOString()),
    });
  }, `sheet-pool-upsert:${entry.sheet_id}`);
}

// ── DELETION QUEUE (manual delete / expiry coordination) ────────────────────
// See docs/DELETION_POLICY.md for the full architecture. This tab is an
// append-only queue, not a key/value tab: each row is one deletion request,
// consumed asynchronously by mainbot's periodic Drive-trash worker (which
// flips `status` from "pending" to "done"/"failed" — this service never
// reads that status back, it only ever appends).

const DELETION_QUEUE_HEADER = ["bot_token", "tenant_sheet_id", "requested_by", "requested_at", "status"];

/** Create the `deletion_queue` tab with its real header if it doesn't exist yet. */
async function ensureDeletionQueueTab(spreadsheetId: string) {
  try {
    const existing = await listTabs(spreadsheetId);
    if (!existing.includes("deletion_queue")) {
      // addTab seeds a generic [key, value] header — overwrite it below with
      // the real 5-column header for this tab.
      await addTab(spreadsheetId, "deletion_queue");
    }
    await writeSheet(spreadsheetId, "deletion_queue!A1:E1", [DELETION_QUEUE_HEADER]);
  } catch (err) {
    logger.warn({ err }, "ensureDeletionQueueTab failed (non-fatal)");
  }
}

export function syncDeletionQueueAdd(entry: {
  bot_token: string;
  tenant_sheet_id?: string | null;
  requested_by: "manual" | "expiry";
}) {
  const spreadsheetId = registrySheetId();
  if (!spreadsheetId) return;
  bg(async () => {
    await ensureDeletionQueueTab(spreadsheetId);
    await appendSheet(spreadsheetId, "deletion_queue", [[
      entry.bot_token,
      entry.tenant_sheet_id ?? "",
      entry.requested_by,
      new Date().toISOString(),
      "pending",
    ]]);
  }, `deletion-queue-add:${entry.bot_token}`);
}
