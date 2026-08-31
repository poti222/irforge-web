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
 *     tab "payments"     → A: key (pay id),   B: value (JSON)
 *     tab "referrals"    → A: key (user id),  B: value (JSON)
 *     tab "promos"       → A: key (promo id), B: value (JSON)
 *     tab "support"      → A: key (ticket id),B: value (JSON)
 *
 *   SHEETS_REGISTRY_ID  (bot registry)
 *     tab "tenants"    → A: key (bot_token),  B: value (JSON)
 *     tab "sheet_pool" → A: key (sheet_id),   B: value (JSON)
 *
 *   Discount codes are NOT synced from here. They never touch Postgres at
 *   all — Google Sheets (this same SHEETS_DATA_ID spreadsheet, tab
 *   "discounts" + "discount_redemptions") is their only home. See
 *   api-server/src/lib/discountStore.ts, which reuses the `upsertKV` /
 *   `deleteKVByKey` / `dataSheetId` helpers below directly (exported for
 *   that purpose) instead of going through a syncX() mirror function.
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
import { encryptToken } from "./tokenCrypto.js";
import { isEntityOnPostgres, getCutoverPool } from "./botConfig.js";

// ─── Types ──────────────────────────────────────────────────────────────────

type KVRow = [string, string]; // [key, JSON-stringified value]

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Resolve the business-data spreadsheet id. For every tab documented above
 * (users, bots, orders, ...) Postgres remains the source of truth and this
 * is just a mirror. The one exception is the "discounts" / "discount_redemptions"
 * tabs, which discountStore.ts owns as the *only* copy of that data — no
 * second name/fallback here either way. See docs/DATA_UNIFICATION.md.
 */
export function dataSheetId(): string | null {
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

/**
 * Ensure a tab exists (creating it if missing — same helper the
 * deletion_queue setup already used) and that it has the [key, value]
 * header row. Previously this only tried to write the header and assumed
 * the tab was already there by hand; if it wasn't, every read/write against
 * that tab failed with a Sheets "Unable to parse range: <tab>" 400 and was
 * swallowed as a silent non-fatal warning — so a tab that was never
 * manually created (e.g. "bots", "tenants") would just never sync, with no
 * visible error anywhere except the server logs.
 */
async function ensureHeader(spreadsheetId: string, tab: string) {
  try {
    await addTab(spreadsheetId, tab); // no-op if the tab already exists
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

/** Upsert a key-value row on a tab. Exported for discountStore.ts (discounts
 *  live only in Sheets, so it needs to write, not just mirror, this way). */
export async function upsertKV(spreadsheetId: string, tab: string, key: string, value: object) {
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

/**
 * Delete one or more rows by key.
 *
 * ── Why this is write-then-trim and not clear-then-write ────────────────────
 * The previous implementation was:
 *
 *     const rows = await readSheet(spreadsheetId, tab);
 *     const filtered = rows.filter(...);
 *     await clearSheet(spreadsheetId, tab);      // ← tab is now EMPTY
 *     if (filtered.length) await writeSheet(...); // ← and only now refilled
 *
 * Between those last two calls the tab holds nothing. A crash, a dropped
 * connection or a Sheets rate-limit in that window left every discount code
 * permanently gone, with no transaction to roll back and no backup. A single
 * delete could destroy the whole dataset.
 *
 * Writing the filtered rows first and only then clearing the surplus tail
 * means the tab always holds either the old data or the new data. The worst
 * case if it dies midway is a few stale trailing rows — recoverable, and
 * nothing like an empty tab.
 *
 * Callers must hold the tab-level lock (see discountStore.ts): this rewrites
 * every row, so two concurrent calls with different keys would otherwise each
 * write back their own pre-delete snapshot and resurrect each other's rows.
 *
 * @returns true if anything was actually removed, so the route can 404 instead
 *          of reporting a successful delete of something that never existed.
 */
export async function deleteKVByKey(spreadsheetId: string, tab: string, key: string): Promise<boolean> {
  return (await deleteKVByKeys(spreadsheetId, tab, [key])) > 0;
}

/** @returns how many rows were removed. */
export async function deleteKVByKeys(
  spreadsheetId: string,
  tab: string,
  keys: string[],
): Promise<number> {
  if (keys.length === 0) return 0;
  const doomed = new Set(keys);

  // Explicit `A:B`, matching readKV/readAllKV. Calling readSheet with a bare
  // tab name let Sheets decide the extent of the data, so the shape read here
  // did not necessarily match the two-column shape the writers produce.
  const rows = await readSheet(spreadsheetId, `${tab}!A:B`);
  if (!rows || rows.length <= 1) return 0;

  const filtered = rows.filter((r, i) => i === 0 || !doomed.has(r[0]));
  const removed = rows.length - filtered.length;
  if (removed === 0) return 0;

  // 1. Overwrite in place, from the top.
  await writeSheet(spreadsheetId, `${tab}!A1`, filtered);
  // 2. Only now clear what is left over below the new last row.
  await clearSheet(spreadsheetId, `${tab}!A${filtered.length + 1}:B`);

  return removed;
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

/** Fire-and-forget wrapper — never throws. The result is discarded, hence
 *  `unknown` rather than `void`: `deleteKVByKey` reports whether it removed
 *  anything, which these mirror calls have no use for. */
function bg(fn: () => Promise<unknown>, label: string) {
  fn().catch((err) => logger.warn({ err }, `sheetsSync [${label}] failed (non-fatal)`));
}

// ─── registry cutover (PHASE 17.27, mainbot/utils/registry.py) ─────────────
//
// IRFORGE_BOTS_REGISTRY_POSTGRES_MIGRATION — unlike every other tab this
// file mirrors (Postgres is already this service's own source of truth,
// Sheets is just a best-effort backup), the REGISTRY tabs (`tenants`,
// `sheet_pool`) are the opposite: mainbot's `utils/registry.py` reads them
// as the authoritative list of which Telegram bots to actually run, and
// mainbot's own PHASE 17.27 cutover framework can move that read over to
// the shared `BUSINESS_DATABASE_URL` Postgres (`registry_tenants` /
// `registry_sheet_pool`, kv_mode, gated by the `tenant_registry` flag in
// `entity_cutover_flags`). If this service kept writing ONLY to Sheets
// after that flag flips, a bot purchased on the website would silently
// never reach mainbot's runtime — there is no request/response cycle here
// to show an error on, this is a fire-and-forget background sync.
//
// So this is a genuine DUAL WRITE, not a "write to whichever is
// authoritative" switch like `botConfig.ts` uses for `bot_settings`: keep
// writing Sheets exactly as before (best-effort, unconditionally) AND, when
// the flag is on, also best-effort write straight to the same Postgres
// tables mainbot's `business_repository.py` (kv_mode) reads — mirroring its
// exact upsert SQL, same `tenant_id = '__registry__'` partition. A stopped
// Sheets write during the migration window is an acceptable staging risk;
// mainbot's registry never seeing a purchased bot at all is not.
const REGISTRY_PG_PARTITION = "__registry__";

async function registryPgUpsert(
  table: "registry_tenants" | "registry_sheet_pool",
  key: string,
  value: object,
): Promise<void> {
  if (!(await isEntityOnPostgres("tenant_registry"))) return;
  const pool = getCutoverPool();
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO ${table} (tenant_id, id, value) VALUES ($1, $2, $3) ` +
        `ON CONFLICT (tenant_id, id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [REGISTRY_PG_PARTITION, key, value],
    );
  } catch (err) {
    logger.warn({ err, table, key }, "registryPgUpsert failed (non-fatal, Sheets write still applies)");
  }
}

async function registryPgDelete(table: "registry_tenants" | "registry_sheet_pool", key: string): Promise<void> {
  if (!(await isEntityOnPostgres("tenant_registry"))) return;
  const pool = getCutoverPool();
  if (!pool) return;
  try {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id = $1 AND id = $2`, [REGISTRY_PG_PARTITION, key]);
  } catch (err) {
    logger.warn({ err, table, key }, "registryPgDelete failed (non-fatal, Sheets delete still applies)");
  }
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

type TenantUpsertInput = {
  bot_token: string; bot_name: string; bot_username?: string | null;
  owner_user_id: string;                 // the site account id
  owner_telegram_id?: string | null;     // the owner's Telegram id — what the bots DM on
  sheet_id?: string | null;
  admin_password?: string | null;
  status?: string;
  bot_purpose?: string | null;
  created_at?: Date | string;
};

/**
 * Pure — no I/O — so the shape (and the fact that `bot_token` really is
 * encrypted, not just documented as such) is unit-testable without a live
 * Sheets or Postgres connection. Write the EXACT field names the main
 * bot's utils/registry.py reads (`spreadsheet_id`, `owner_id`,
 * `admin_password`, `status`, `bot_purpose`) so a tenant registered from
 * the site is picked up by the bot runtime — plus the older site aliases
 * for backward compatibility. `bot_token` is encrypted (tokenCrypto.ts, the
 * exact same AES-256-GCM format mainbot's own
 * utils/registry_token_crypto.py reads/writes) — never the live token in
 * plain text, on either backend. The row's own *key* stays the plaintext
 * token on both sides; that's how mainbot looks a tenant up by the token
 * it already has in hand.
 */
function buildTenantRegistryValue(tenant: TenantUpsertInput) {
  const sheet = tenant.sheet_id ?? "";
  return {
    bot_token: encryptToken(tenant.bot_token),
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
  };
}

export function syncTenantUpsert(tenant: TenantUpsertInput) {
  bg(async () => {
    const value = buildTenantRegistryValue(tenant);

    await registryPgUpsert("registry_tenants", tenant.bot_token, value);

    const spreadsheetId = registrySheetId();
    if (!spreadsheetId) return;
    await upsertKV(spreadsheetId, "tenants", tenant.bot_token, value);
  }, `tenant-upsert:${tenant.owner_user_id}`);
}

export function syncTenantDelete(botToken: string) {
  bg(async () => {
    await registryPgDelete("registry_tenants", botToken);
    const spreadsheetId = registrySheetId();
    if (!spreadsheetId) return;
    await deleteKVByKey(spreadsheetId, "tenants", botToken);
  }, `tenant-delete`);
}

// ── SHEET POOL ─────────────────────────────────────────────────────────────

type SheetPoolUpsertInput = {
  sheet_id: string;
  assigned_to?: string | null; // Postgres bot id — kept in the call signature for callers, not written to the sheet
  used_by?: string | null;     // the bot's own Telegram token — what mainbot actually reads/writes
  status: "free" | "available" | "assigned";
  created_at?: Date | string;
};

/**
 * Pure — matches mainbot's own row shape exactly: {spreadsheet_id, used_by}
 * only (used_by truthy = taken, and it must be the bot's own Telegram
 * token — the same thing mainbot writes when a tenant is created directly
 * through the bot). No extra fields — nothing in this codebase reads this
 * tab back, so anything beyond what mainbot itself expects just makes the
 * row diverge from mainbot's own writes for no reason.
 *
 * `used_by` is deliberately left as the plain token here, matching
 * mainbot's own registry.py choice: it's a same-value copy of the
 * canonical (encrypted) token already on the `tenants` row, used only as
 * an equality-comparable "is this sheet taken, by which token" marker
 * (`_release_sheet_to_pool`'s `entry.used_by == bot_token`) — encrypting
 * it (non-deterministic, random IV per call) would break that comparison
 * on both backends.
 */
function buildSheetPoolValue(entry: SheetPoolUpsertInput) {
  const usedBy = entry.status === "assigned" ? (entry.used_by ?? null) : null;
  return { spreadsheet_id: entry.sheet_id, used_by: usedBy };
}

export function syncSheetPoolUpsert(entry: SheetPoolUpsertInput) {
  bg(async () => {
    const value = buildSheetPoolValue(entry);

    await registryPgUpsert("registry_sheet_pool", entry.sheet_id, value);

    const spreadsheetId = registrySheetId();
    if (!spreadsheetId) return;
    await upsertKV(spreadsheetId, "sheet_pool", entry.sheet_id, value);
  }, `sheet-pool-upsert:${entry.sheet_id}`);
}

/** Remove a sheet's row from the registry's `sheet_pool` tab (super-admin delete/replace). */
export function syncSheetPoolDelete(sheetId: string) {
  bg(async () => {
    await registryPgDelete("registry_sheet_pool", sheetId);
    const spreadsheetId = registrySheetId();
    if (!spreadsheetId) return;
    await deleteKVByKey(spreadsheetId, "sheet_pool", sheetId);
  }, `sheet-pool-delete:${sheetId}`);
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

/** فقط برای تست — منطقِ خالص (بدون I/O) و مسیرِ نوشتنِ رجیستری روی Postgres. */
export const __testables = { buildTenantRegistryValue, buildSheetPoolValue, registryPgUpsert, registryPgDelete };
