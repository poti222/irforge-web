/**
 * lib/schoolWallet.ts — کیف‌پولِ مدرسه (جدا از lib/wallet.ts که کیف‌پولِ شخصیِ کاربر است).
 * ─────────────────────────────────────────────────────────────────────────
 * همان قراردادِ `deductWallet`: کسر یک UPDATEِ شرطی است (`WHERE balance >= amt`) نه خواندن-مقایسه-نوشتن؛ پس دو خریدِ هم‌زمان
 * نمی‌توانند موجودی را منفی کنند. `executor` می‌تواند `tx` باشد تا کسر با claimِ توکنِ استخر و ساختِ school_bots یک‌جا
 * commit/rollback شود — صدازننده باید در صورتِ `false` از داخلِ تراکنش **throw** کند (return ساده commit می‌کند).
 */
import { db, schoolWalletsTable, schoolWalletTransactionsTable } from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";
import crypto from "crypto";

export class SchoolWalletInsufficientError extends Error {}

export type SchoolWalletTxnType = "credit" | "spend" | "admin_credit" | "admin_debit";

export const SCHOOL_WALLET_MAX_AMOUNT_RIAL = 1_000_000_000;

export async function ensureSchoolWallet(schoolId: string, executor: any = db): Promise<void> {
  await executor.insert(schoolWalletsTable).values({ schoolId, balance: 0 }).onConflictDoNothing();
}

export async function getSchoolWalletBalance(schoolId: string, executor: any = db): Promise<number> {
  await ensureSchoolWallet(schoolId, executor);
  const [w] = await executor.select({ balance: schoolWalletsTable.balance }).from(schoolWalletsTable).where(eq(schoolWalletsTable.schoolId, schoolId)).limit(1);
  return w?.balance ?? 0;
}

interface MoveInput { schoolId: string; amountRial: number; type: SchoolWalletTxnType; description: string; refId?: string | null; createdByUserId?: string | null }

function checkAmount(a: number): number {
  const amt = Math.round(Number(a));
  if (!Number.isSafeInteger(amt) || amt <= 0 || amt > SCHOOL_WALLET_MAX_AMOUNT_RIAL) throw new RangeError("invalid school wallet amount");
  return amt;
}

/** شارژ: جمع در خودِ SQL + ردیفِ ledger با balanceAfter. موجودیِ تازه را برمی‌گرداند. */
export async function creditSchoolWallet(input: MoveInput, executor: any = db): Promise<{ balance: number; txnId: string }> {
  const amt = checkAmount(input.amountRial);
  await ensureSchoolWallet(input.schoolId, executor);
  const [w] = await executor.update(schoolWalletsTable)
    .set({ balance: sql`${schoolWalletsTable.balance} + ${amt}`, updatedAt: new Date() })
    .where(eq(schoolWalletsTable.schoolId, input.schoolId)).returning();
  const txnId = crypto.randomUUID();
  await executor.insert(schoolWalletTransactionsTable).values({
    id: txnId, schoolId: input.schoolId, type: input.type, amount: amt, balanceAfter: w.balance,
    description: input.description, refId: input.refId ?? null, createdByUserId: input.createdByUserId ?? null,
  });
  return { balance: w.balance, txnId };
}

/** کسرِ شرطی؛ ناکافی → null (بدونِ هیچ نوشتنی). */
export async function debitSchoolWallet(input: MoveInput, executor: any = db): Promise<{ balance: number; txnId: string } | null> {
  const amt = checkAmount(input.amountRial);
  await ensureSchoolWallet(input.schoolId, executor);
  const [w] = await executor.update(schoolWalletsTable)
    .set({ balance: sql`${schoolWalletsTable.balance} - ${amt}`, updatedAt: new Date() })
    .where(and(eq(schoolWalletsTable.schoolId, input.schoolId), gte(schoolWalletsTable.balance, amt))).returning();
  if (!w) return null;
  const txnId = crypto.randomUUID();
  await executor.insert(schoolWalletTransactionsTable).values({
    id: txnId, schoolId: input.schoolId, type: input.type, amount: amt, balanceAfter: w.balance,
    description: input.description, refId: input.refId ?? null, createdByUserId: input.createdByUserId ?? null,
  });
  return { balance: w.balance, txnId };
}
