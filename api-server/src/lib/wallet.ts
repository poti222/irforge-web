/**
 * lib/wallet.ts — کسر/شارژِ کیف‌پول، مشترک بین همه‌ی مسیرهایی که به آن دست می‌زنند.
 * ─────────────────────────────────────────────────────────────────────────────
 * قبلاً `deductWallet`/`InsufficientBalanceError` فقط داخل `routes/bots.ts`
 * بودند (خرید بات، خرید پلاگین). Phase 34 اشتراک/تمدید/ارتقا را هم از همان
 * کیف‌پول پرداخت می‌کند، پس این تابع مشترک شد به‌جای اینکه یک کپیِ سوم از
 * همان منطقِ کسرِ اتمی جای دیگری نوشته شود.
 *
 * Phase 36: `ensureWallet` هم از `routes/wallet.ts` به اینجا منتقل شد
 * (همان دلیل) و `creditWallet` تازه اضافه شد — سوپرادمین حالا می‌تواند
 * مستقیم به کیف پول یک کاربر شارژ/کسر بزند (`routes/superAdminUsers.ts`).
 * این کسر/شارژ عمداً `type: "admin_credit"/"admin_debit"` می‌گیرد، نه
 * `"spend"`/یکی از انواعِ واریز — `lib/adminRevenue.ts` فقط `type = "spend"`
 * را درآمد می‌شمارد، و تصحیحِ دستیِ یک ادمین درآمدِ واقعی نیست.
 */
import { db, walletsTable, walletTransactionsTable } from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";
import crypto from "crypto";

/** پرتاب می‌شود تا یک تراکنشِ `db.transaction` تمیز rollback شود — موجودی کافی نبود. */
export class InsufficientBalanceError extends Error {}

export type WalletRow = { id: string; userId: string; balance: number };

/** کیف‌پولِ یک کاربر را برمی‌گرداند، و اگر هنوز نساخته با موجودیِ صفر می‌سازد. */
export async function ensureWallet(userId: string, executor: any = db): Promise<WalletRow> {
  const [existing] = await executor.select().from(walletsTable).where(eq(walletsTable.userId, userId)).limit(1);
  if (existing) return existing;
  try {
    const [created] = await executor.insert(walletsTable).values({ id: crypto.randomUUID(), userId, balance: 0 }).returning();
    return created;
  } catch {
    // رقابتِ دو درخواستِ هم‌زمان روی اولین ساختِ کیف‌پول — دومی این‌جا می‌افتد.
    const [w] = await executor.select().from(walletsTable).where(eq(walletsTable.userId, userId)).limit(1);
    return w;
  }
}

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
 *
 * `type` پیش‌فرضش `"spend"` است (خرید واقعی، همان چیزی که `lib/adminRevenue.ts`
 * می‌شمارد) — کسرِ دستیِ سوپرادمین (`creditWallet`ی برعکس) با `type:
 * "admin_debit"` صدا می‌زند تا در آمار درآمد دیده نشود.
 */
export async function deductWallet(
  userId: string,
  amount: number,
  note: string,
  executor: any = db,
  type: string = "spend",
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
    id: crypto.randomUUID(), userId, type, amount: amt, status: "approved", reviewNote: note,
  });
  return true;
}

/**
 * شارژِ بدون‌شرط (برخلاف کسر، شارژ هرگز رد نمی‌شود) — در خودِ SQL جمع می‌زند
 * (`balance + amt`)، نه «موجودیِ خوانده‌شده + مبلغ»، دقیقاً به همان دلیلی که
 * `deductWallet` هم در خودِ SQL کم می‌کند. کیف‌پول را اگر نبود می‌سازد.
 * موجودیِ تازه را برمی‌گرداند.
 */
export async function creditWallet(
  userId: string,
  amount: number,
  note: string,
  type: string = "admin_credit",
  executor: any = db,
): Promise<number> {
  const amt = Math.round(Number(amount) || 0);
  await ensureWallet(userId, executor);

  const [updated] = await executor
    .update(walletsTable)
    .set({ balance: sql`${walletsTable.balance} + ${amt}` })
    .where(eq(walletsTable.userId, userId))
    .returning();

  await executor.insert(walletTransactionsTable).values({
    id: crypto.randomUUID(), userId, type, amount: amt, status: "approved", reviewNote: note,
  });
  return updated.balance;
}
