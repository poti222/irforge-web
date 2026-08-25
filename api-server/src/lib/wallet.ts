/**
 * lib/wallet.ts — کسر از کیف‌پول، مشترک بین همه‌ی مسیرهای خرید.
 * ─────────────────────────────────────────────────────────────────────────────
 * قبلاً `deductWallet`/`InsufficientBalanceError` فقط داخل `routes/bots.ts`
 * بودند (خرید بات، خرید پلاگین). Phase 34 اشتراک/تمدید/ارتقا را هم از همان
 * کیف‌پول پرداخت می‌کند، پس این تابع مشترک شد به‌جای اینکه یک کپیِ سوم از
 * همان منطقِ کسرِ اتمی جای دیگری نوشته شود.
 */
import { db, walletsTable, walletTransactionsTable } from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";
import crypto from "crypto";

/** پرتاب می‌شود تا یک تراکنشِ `db.transaction` تمیز rollback شود — موجودی کافی نبود. */
export class InsufficientBalanceError extends Error {}

/**
 * کسر **مشروط**، در یک دستور (نگاه کن به کامنتِ اصلی که از اینجا منتقل شده):
 * شرط داخل `WHERE` است، نه یک خواندن-مقایسه-نوشتنِ جدا — پس دو خریدِ هم‌زمان
 * نمی‌توانند هر دو از یک موجودیِ ناکافی رد شوند.
 *
 * مبلغِ صفر یا منفی (پلاگینِ رایگان، کد تخفیفی که کل مبلغ را صفر کرده) بدون
 * نوشتن هیچ ردیفی موفق برمی‌گردد.
 *
 * `executor` پیش‌فرضش همان `db` است ولی `tx` یک `db.transaction` را هم می‌پذیرد
 * — وقتی کسرِ کیف‌پول باید با کارهای دیگر (مثل رزرو کد تخفیف) با هم commit/rollback شود.
 */
export async function deductWallet(
  userId: string,
  amount: number,
  note: string,
  executor: any = db,
): Promise<boolean> {
  const amt = Math.round(Number(amount) || 0);
  if (amt <= 0) return true;

  const updated = await executor
    .update(walletsTable)
    .set({ balance: sql`${walletsTable.balance} - ${amt}` })
    .where(and(eq(walletsTable.userId, userId), gte(walletsTable.balance, amt)))
    .returning();
  if (updated.length === 0) return false;

  await executor.insert(walletTransactionsTable).values({
    id: crypto.randomUUID(), userId, type: "spend", amount: amt, status: "approved", reviewNote: note,
  });
  return true;
}
