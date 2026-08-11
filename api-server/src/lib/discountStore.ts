/**
 * discountStore.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Discount codes — moved off Postgres entirely. This module is now the only
 * place discount-code data lives: Google Sheets (`SHEETS_DATA_ID` → tab
 * "discounts" for the codes themselves, tab "discount_redemptions" for the
 * append-only audit log). Postgres has zero tables for this data — see
 * api-server/migrate.mjs, which actively DROPs discount_codes /
 * discount_redemptions if they exist from before this change.
 *
 * When SHEETS_DATA_ID isn't configured (local dev / CI without Google
 * creds), this falls back to an in-memory map + a JSON file on disk, same
 * pattern as botLanguageStore.ts, so the dashboard still works.
 *
 * ─── Why this is NOT a drop-in replacement for a real DB ────────────────────
 * Google Sheets has no transactions and no row locks. `reserveDiscount()`
 * below uses an in-process async mutex plus a fresh re-read of the row right
 * before anything is decided, which closes the race window for a *single*
 * server process — two requests hitting the same instance can't both spend
 * the last use of a maxUses-capped code. It does NOT protect against two
 * separate server instances (e.g. horizontally-scaled replicas) doing that
 * at the same moment; a couple of extra redemptions could slip through in
 * that scenario. If irforge-web ever runs with >1 replica, this needs a real
 * distributed lock — flagged here rather than silently assumed away.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readKV, readAllKV, upsertKV, deleteKVByKey, deleteKVByKeys, dataSheetId } from "./sheetsSync.js";
import { writeSheet, appendSheet, addTab, listTabs } from "./sheets.js";
import { computeDiscount, type DiscountKind } from "./discounts.js";
import { logger } from "./logger.js";

export type { DiscountKind };

export interface DiscountCode {
  id: string;
  code: string;
  kind: DiscountKind;
  value: number;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null; // ISO, or null
  active: boolean;
  createdBy: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface DiscountRedemption {
  id: string;
  codeId: string;
  code: string;
  userId: string;
  orderAmount: number;
  discountAmount: number;
  createdAt: string; // ISO
}

const TAB = "discounts";
const REDEMPTIONS_TAB = "discount_redemptions";
const REDEMPTIONS_HEADER = ["id", "code_id", "code", "user_id", "order_amount", "discount_amount", "created_at"];

const DEV_FILE = path.join(process.cwd(), ".dev-discounts.json");

export type DiscountReason = "not_found" | "inactive" | "expired" | "exhausted";

export class DiscountCodeError extends Error {
  constructor(public reason: DiscountReason, message: string) {
    super(message);
  }
}

export class DuplicateDiscountCodeError extends Error {
  constructor() {
    super("This discount code already exists");
  }
}

const DISCOUNT_ERROR_MESSAGES_FA: Record<DiscountReason, string> = {
  not_found: "کد تخفیف پیدا نشد",
  inactive: "این کد تخفیف غیرفعال است",
  expired: "این کد تخفیف منقضی شده است",
  exhausted: "سقف استفاده از این کد تخفیف پر شده است",
};

// ─── In-process mutex (see caveat above) ────────────────────────────────────
//
// Two kinds of lock:
//
//   `code:<CODE>`  — one row's value. Held across a whole reservation, i.e.
//                    for as long as a payment takes.
//   `tab:discounts`— the WHOLE tab. Any operation that rewrites every row
//                    takes this. That is what was missing: `deleteKVByKey`
//                    reads, rewrites and trims the entire tab, but deletion
//                    only took a per-code lock, so deleting two *different*
//                    codes took two different locks and did not exclude each
//                    other. Both read the full sheet and both wrote back their
//                    own filtered copy, and the second write — built from a
//                    snapshot taken before the first delete — put the first
//                    deleted code back. Hence "codes come back".
//
// ── Lock ordering: code first, tab last. The tab lock is always innermost. ──
//
// The brief for this work said to take the tab lock *before* the code lock.
// That ordering cannot work here, and taking it literally would have replaced
// a data-loss bug with a deadlock: `reserveDiscount` acquires a code lock and
// holds it across the caller's payment transaction, then writes on commit. If
// the write had to take the tab lock while that code lock was held, then a
// concurrent delete holding the tab lock and waiting for the same code lock
// would deadlock — each waiting on what the other holds.
//
// So the order is inverted and, more importantly, made consistent: a code lock
// may be taken while holding nothing, and the tab lock is only ever taken as a
// leaf, for the duration of one rewrite. Nothing acquires a code lock while
// holding the tab lock. That preserves the actual requirement — every
// whole-tab rewrite is mutually exclusive — without serialising payments
// behind a global lock, which is what tab-outermost would have done.

const locks = new Map<string, Promise<void>>();

/** How long to wait for a lock before giving up. */
const LOCK_TIMEOUT_MS = 10_000;

export class LockTimeoutError extends Error {
  constructor(key: string) {
    super(`Timed out after ${LOCK_TIMEOUT_MS}ms waiting for lock "${key}"`);
  }
}

/**
 * `acquireLock` used to wait forever. A deadlock or a leaked release therefore
 * hung the request until the client gave up, consuming a handler slot with no
 * error anywhere — invisible in logs and indistinguishable from a slow Sheets
 * API. Now it throws, so the same bug shows up as a 500 with a stack.
 */
async function acquireLock(key: string, timeoutMs = LOCK_TIMEOUT_MS): Promise<() => void> {
  const deadline = Date.now() + timeoutMs;
  while (locks.has(key)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new LockTimeoutError(key);
    const held = locks.get(key)!;
    // Race the holder against the deadline so a stuck holder can't pin us here.
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      held.catch(() => {}),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, remaining); }),
    ]);
    if (timer) clearTimeout(timer);
  }
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  locks.set(key, gate);
  let released = false;
  return () => {
    if (released) return; // double release would free someone else's lock
    released = true;
    locks.delete(key);
    release();
  };
}

/** The tab-wide lock. Always the innermost lock — see the ordering note above. */
const TAB_LOCK = `tab:${TAB}`;

async function withTabLock<T>(fn: () => Promise<T>): Promise<T> {
  const release = await acquireLock(TAB_LOCK);
  try {
    return await fn();
  } finally {
    release();
  }
}

// ─── Dev fallback (no SHEETS_DATA_ID configured) ────────────────────────────

interface DevFile {
  codes: Record<string, DiscountCode>; // keyed by UPPERCASE code
  redemptions: DiscountRedemption[];
}

const mem: DevFile = { codes: {}, redemptions: [] };
let memLoaded = false;

function readDevFile(): DevFile {
  if (!memLoaded) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DEV_FILE, "utf8"));
      mem.codes = parsed.codes ?? {};
      mem.redemptions = parsed.redemptions ?? [];
    } catch {
      /* no file yet — start empty */
    }
    memLoaded = true;
  }
  return mem;
}

function writeDevFile() {
  try {
    fs.writeFileSync(DEV_FILE, JSON.stringify(mem, null, 2));
  } catch {
    /* read-only fs in some envs — in-memory copy still serves this run */
  }
}

// ─── Low-level row access ────────────────────────────────────────────────────

async function findByCode(code: string): Promise<DiscountCode | null> {
  const spreadsheetId = dataSheetId();
  if (spreadsheetId) {
    try {
      return await readKV<DiscountCode>(spreadsheetId, TAB, code);
    } catch (err) {
      logger.warn({ err, code }, "discountStore.findByCode: sheet read failed, using fallback");
    }
  }
  return readDevFile().codes[code] ?? null;
}

async function listAll(): Promise<DiscountCode[]> {
  const spreadsheetId = dataSheetId();
  if (spreadsheetId) {
    try {
      return await readAllKV<DiscountCode>(spreadsheetId, TAB);
    } catch (err) {
      logger.warn({ err }, "discountStore.listAll: sheet read failed, using fallback");
    }
  }
  return Object.values(readDevFile().codes);
}

// The `*Unlocked` variants assume the caller already holds the tab lock. They
// exist so a rename — delete the old row, write the new one — happens inside a
// single critical section instead of two, which would let another rewrite
// interleave between them and lose one of the two writes.

async function writeRowUnlocked(row: DiscountCode): Promise<void> {
  const spreadsheetId = dataSheetId();
  if (spreadsheetId) {
    await upsertKV(spreadsheetId, TAB, row.code, row);
    return;
  }
  const file = readDevFile();
  file.codes[row.code] = row;
  writeDevFile();
}

/** @returns false when the key wasn't there — the caller can answer 404. */
async function deleteRowByCodeUnlocked(code: string): Promise<boolean> {
  const spreadsheetId = dataSheetId();
  if (spreadsheetId) {
    return await deleteKVByKey(spreadsheetId, TAB, code);
  }
  const file = readDevFile();
  if (!(code in file.codes)) return false;
  delete file.codes[code];
  writeDevFile();
  return true;
}

/** Delete several codes in ONE rewrite — see deleteDiscountCodes(). */
async function deleteRowsByCodeUnlocked(codes: string[]): Promise<number> {
  const spreadsheetId = dataSheetId();
  if (spreadsheetId) {
    return await deleteKVByKeys(spreadsheetId, TAB, codes);
  }
  const file = readDevFile();
  let removed = 0;
  for (const code of codes) {
    if (code in file.codes) { delete file.codes[code]; removed++; }
  }
  if (removed > 0) writeDevFile();
  return removed;
}

const writeRow = (row: DiscountCode) => withTabLock(() => writeRowUnlocked(row));
const deleteRowByCode = (code: string) => withTabLock(() => deleteRowByCodeUnlocked(code));

/** Create the append-only `discount_redemptions` tab with its real 7-column
 *  header if it doesn't exist yet (mirrors sheetsSync's deletion_queue setup:
 *  addTab seeds a generic [key, value] header, then this overwrites it with
 *  the real header before anything is ever appended). */
async function ensureRedemptionsTab(spreadsheetId: string) {
  try {
    const existing = await listTabs(spreadsheetId);
    if (!existing.includes(REDEMPTIONS_TAB)) {
      await addTab(spreadsheetId, REDEMPTIONS_TAB);
    }
    await writeSheet(spreadsheetId, `${REDEMPTIONS_TAB}!A1:G1`, [REDEMPTIONS_HEADER]);
  } catch (err) {
    logger.warn({ err }, "discountStore.ensureRedemptionsTab failed (non-fatal)");
  }
}

async function appendRedemption(entry: DiscountRedemption): Promise<void> {
  const spreadsheetId = dataSheetId();
  if (spreadsheetId) {
    await ensureRedemptionsTab(spreadsheetId);
    await appendSheet(spreadsheetId, REDEMPTIONS_TAB, [[
      entry.id, entry.codeId, entry.code, entry.userId,
      String(entry.orderAmount), String(entry.discountAmount), entry.createdAt,
    ]]);
    return;
  }
  const file = readDevFile();
  file.redemptions.push(entry);
  writeDevFile();
}

// ─── Public CRUD (admin routes) ──────────────────────────────────────────────

export async function listDiscountCodes(): Promise<DiscountCode[]> {
  const all = await listAll();
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getDiscountByCode(rawCode: string): Promise<DiscountCode | null> {
  return findByCode(rawCode.trim().toUpperCase());
}

export async function getDiscountById(id: string): Promise<DiscountCode | null> {
  const all = await listAll();
  return all.find((c) => c.id === id) ?? null;
}

export async function createDiscountCode(input: {
  code: string;
  kind: DiscountKind;
  value: number;
  maxUses: number | null;
  expiresAt: string | null;
  active: boolean;
  createdBy: string;
}): Promise<DiscountCode> {
  const code = input.code.trim().toUpperCase();
  const release = await acquireLock(`code:${code}`);
  try {
    const existing = await findByCode(code);
    if (existing) throw new DuplicateDiscountCodeError();
    const now = new Date().toISOString();
    const row: DiscountCode = {
      id: crypto.randomUUID(),
      code,
      kind: input.kind,
      value: input.value,
      maxUses: input.maxUses,
      usedCount: 0,
      expiresAt: input.expiresAt,
      active: input.active,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    await writeRow(row);
    return row;
  } finally {
    release();
  }
}

export async function updateDiscountCode(
  id: string,
  patch: Partial<Pick<DiscountCode, "code" | "kind" | "value" | "maxUses" | "expiresAt" | "active">>,
): Promise<DiscountCode | null | { error: "duplicate" }> {
  const existing = await getDiscountById(id);
  if (!existing) return null;

  const newCode = patch.code !== undefined ? patch.code.trim().toUpperCase() : existing.code;
  const oldCode = existing.code;
  const codeChanged = newCode !== oldCode;

  // Lock whichever code(s) are involved, in a stable order, so a rename can't
  // race a create/redeem on either the old or the new code.
  const lockKeys = Array.from(new Set([`code:${oldCode}`, `code:${newCode}`])).sort();
  const releases = await Promise.all(lockKeys.map((k) => acquireLock(k)));
  try {
    if (codeChanged) {
      const dupe = await findByCode(newCode);
      if (dupe && dupe.id !== id) return { error: "duplicate" };
    }

    const updated: DiscountCode = {
      ...existing,
      ...patch,
      code: newCode,
      updatedAt: new Date().toISOString(),
    };

    // One tab lock around both halves of a rename, so no other rewrite can
    // land between the delete and the write and drop one of them.
    await withTabLock(async () => {
      if (codeChanged) await deleteRowByCodeUnlocked(oldCode);
      await writeRowUnlocked(updated);
    });
    return updated;
  } finally {
    releases.forEach((r) => r());
  }
}

export async function deleteDiscountCode(id: string): Promise<boolean> {
  const existing = await getDiscountById(id);
  if (!existing) return false;
  const release = await acquireLock(`code:${existing.code}`);
  try {
    return await deleteRowByCode(existing.code);
  } finally {
    release();
  }
}

/**
 * Delete many codes in a SINGLE whole-tab rewrite.
 *
 * The admin UI's bulk action routes here rather than calling the single-delete
 * endpoint in a loop. A loop would be N sequential rewrites of the whole tab —
 * N times the chance of dying halfway, and on Sheets' rate limits the tail of
 * that loop is where the failures land.
 *
 * @returns the ids that were actually removed; ids not found are simply absent,
 *          so the caller can report a partial result honestly.
 */
export async function deleteDiscountCodes(ids: string[]): Promise<string[]> {
  const all = await listAll();
  const targets = all.filter((c) => ids.includes(c.id));
  if (targets.length === 0) return [];

  // Code locks first (sorted, so two overlapping bulk deletes can't deadlock
  // by grabbing the same pair in opposite orders), tab lock innermost.
  const codeKeys = Array.from(new Set(targets.map((t) => `code:${t.code}`))).sort();
  const releases: Array<() => void> = [];
  try {
    for (const key of codeKeys) releases.push(await acquireLock(key));
    await withTabLock(() => deleteRowsByCodeUnlocked(targets.map((t) => t.code)));
    return targets.map((t) => t.id);
  } finally {
    releases.forEach((r) => r());
  }
}

// ─── Reservation flow (checkout / wallet purchase) ──────────────────────────
//
// Two-phase so a code is only ever actually spent once payment has cleared:
//   1. reserveDiscount() validates + locks + computes the discounted amount,
//      but does NOT mutate anything yet.
//   2. The caller runs its (Postgres) payment transaction using finalAmount.
//   3. On success the caller calls reservation.commit() — this increments
//      usedCount and appends the audit row, then releases the lock.
//      On failure the caller calls reservation.release() instead — nothing
//      is written, the code is untouched, lock released.

export interface DiscountReservation {
  discountAmount: number;
  finalAmount: number;
  codeId: string;
  commit(): Promise<void>;
  release(): void;
}

export async function reserveDiscount(
  rawCode: string,
  userId: string,
  orderAmount: number,
): Promise<DiscountReservation> {
  const code = rawCode.trim().toUpperCase();
  const release = await acquireLock(`code:${code}`);

  let row: DiscountCode | null;
  try {
    row = await findByCode(code);
  } catch (err) {
    release();
    throw err;
  }

  if (!row) {
    release();
    throw new DiscountCodeError("not_found", DISCOUNT_ERROR_MESSAGES_FA.not_found);
  }
  if (!row.active) {
    release();
    throw new DiscountCodeError("inactive", DISCOUNT_ERROR_MESSAGES_FA.inactive);
  }
  if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
    release();
    throw new DiscountCodeError("expired", DISCOUNT_ERROR_MESSAGES_FA.expired);
  }
  if (row.maxUses != null && row.usedCount >= row.maxUses) {
    release();
    throw new DiscountCodeError("exhausted", DISCOUNT_ERROR_MESSAGES_FA.exhausted);
  }

  const { discountAmount, finalAmount } = computeDiscount(row.kind, row.value, orderAmount);
  const lockedRow = row;
  let settled = false;

  return {
    discountAmount,
    finalAmount,
    codeId: lockedRow.id,
    async commit() {
      if (settled) return;
      settled = true;
      try {
        await writeRow({ ...lockedRow, usedCount: lockedRow.usedCount + 1, updatedAt: new Date().toISOString() });
        await appendRedemption({
          id: crypto.randomUUID(),
          codeId: lockedRow.id,
          code: lockedRow.code,
          userId,
          orderAmount: Math.round(orderAmount),
          discountAmount,
          createdAt: new Date().toISOString(),
        });
      } finally {
        release();
      }
    },
    release() {
      if (settled) return;
      settled = true;
      release();
    },
  };
}
