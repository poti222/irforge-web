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
import { readKV, readAllKV, upsertKV, deleteKVByKey, dataSheetId } from "./sheetsSync.js";
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

const locks = new Map<string, Promise<void>>();

async function acquireLock(key: string): Promise<() => void> {
  while (locks.has(key)) {
    await locks.get(key)!.catch(() => {});
  }
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  locks.set(key, gate);
  return () => {
    locks.delete(key);
    release();
  };
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

async function writeRow(row: DiscountCode): Promise<void> {
  const spreadsheetId = dataSheetId();
  if (spreadsheetId) {
    await upsertKV(spreadsheetId, TAB, row.code, row);
    return;
  }
  const file = readDevFile();
  file.codes[row.code] = row;
  writeDevFile();
}

async function deleteRowByCode(code: string): Promise<void> {
  const spreadsheetId = dataSheetId();
  if (spreadsheetId) {
    await deleteKVByKey(spreadsheetId, TAB, code);
    return;
  }
  const file = readDevFile();
  delete file.codes[code];
  writeDevFile();
}

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

    if (codeChanged) await deleteRowByCode(oldCode);
    await writeRow(updated);
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
    await deleteRowByCode(existing.code);
    return true;
  } finally {
    release();
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
