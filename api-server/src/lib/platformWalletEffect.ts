/**
 * lib/platformWalletEffect.ts — اثرِ تأییدِ شارژِ کیف‌پولِ خودِ IrForge
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۸؛ scope=platform، purpose=wallet_topup).
 *
 * موتورِ تأیید (`paymentMatcher.confirmRequestTx` / `paymentDecisions`) این تابع را **داخلِ همان تراکنشِ
 * تأیید و با همان `client`** صدا می‌زند؛ پس «status=confirmed» و «موجودی + ردیفِ ledger» با هم commit یا با هم
 * rollback می‌شوند — پنجره‌ی «تأیید شد ولی شارژ نشد» (که مسیرِ قدیمی داشت: UPDATE وضعیت، بعد creditWallet جدا)
 * وجود ندارد. تأییدِ دوباره‌ی همان درخواست هم اثرِ دوم ندارد: `UPDATE … WHERE status IN (pending, awaiting_review)`
 * شرطی است و فقط یک تماس‌گیرنده برنده می‌شود.
 *
 * به کیف‌پول همیشه `base_amount_rial` (مبلغی که کاربر خواسته) واریز می‌شود، نه `final_amount_rial`
 * (پسوندِ یکتاساز فقط برایِ تطبیقِ پیامک است و پولِ کاربر نیست).
 *
 * این فایل عمداً به drizzle/@workspace/db وابسته نیست (فقط SQL روی `client`)، تا در تراکنشِ موتور بنشیند.
 */
import crypto from "crypto";
import type { ClientLike, PaymentRequestRow } from "./paymentRequests";

/** نوعِ ردیفِ ledger؛ `lib/adminRevenue.ts` فقط `spend` را درآمد می‌شمارد، پس شارژ درآمد حساب نمی‌شود. */
export const PLATFORM_TOPUP_LEDGER_TYPE = "deposit_card_auto";

/** شارژِ اتمیِ کیف‌پول با SQL خام روی `client` (کیف‌پول را اگر نبود می‌سازد). موجودیِ تازه را برمی‌گرداند. */
export async function creditWalletTx(
  c: ClientLike, userId: string, amountRial: number, note: string, type: string = PLATFORM_TOPUP_LEDGER_TYPE,
): Promise<number> {
  if (!Number.isSafeInteger(amountRial) || amountRial <= 0) throw new Error("credit amount must be a positive integer (Rial)");
  await c.query(
    "INSERT INTO wallets (id, user_id, balance) VALUES ($1, $2, 0) ON CONFLICT (user_id) DO NOTHING",
    [crypto.randomUUID(), userId]);
  // جمع در خودِ SQL (نه «موجودیِ خوانده‌شده + مبلغ»)؛ سرریزِ INTEGER خودش خطا می‌دهد و تأیید rollback می‌شود.
  const { rows } = await c.query(
    "UPDATE wallets SET balance = balance + $2, updated_at = NOW() WHERE user_id = $1 RETURNING balance",
    [userId, amountRial]);
  if (!rows[0]) throw new Error("wallet row missing after ensure");
  await c.query(
    `INSERT INTO wallet_transactions (id, user_id, type, amount, status, review_note)
     VALUES ($1, $2, $3, $4, 'approved', $5)`,
    [crypto.randomUUID(), userId, type, amountRial, note]);
  return Number(rows[0].balance);
}

export async function platformWalletTopupEffect(c: ClientLike, request: PaymentRequestRow): Promise<void> {
  const by = request.confirmedBy === "admin" ? "تأییدِ دستیِ ادمین" : "تأییدِ خودکار با پیامک بانک";
  await creditWalletTx(
    c, request.userId, request.baseAmountRial,
    `شارژ کیف‌پول — ${by} (درخواست ${request.id})`,
  );
  // اثر همین‌جا و در همین تراکنش اعمال شد: ردیف را «claim+done» علامت بزن تا هیچ گزارشی (مثلاً «اثرِ گیرکرده»
  // در پنلِ ادمین) آن را اثرِ اعمال‌نشده نبیند. (برایِ scope=bot این کار را خودِ بات با claim/done می‌کند.)
  await c.query(
    `UPDATE payment_requests SET effect_claimed_at = NOW(), effect_done_at = NOW()
      WHERE id = $1 AND status = 'confirmed' AND effect_claimed_at IS NULL`,
    [request.id]);
}
