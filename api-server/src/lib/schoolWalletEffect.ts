/**
 * lib/schoolWalletEffect.ts — اثرِ تأییدِ شارژِ «کیف‌پولِ مدرسه» (scope=platform، purpose=school_wallet_topup).
 *
 * دقیقاً هم‌الگویِ `platformWalletEffect.ts`: موتورِ تأیید این تابع را داخلِ همان تراکنشِ تأیید و با همان `client` صدا می‌زند،
 * پس «status=confirmed» و «موجودیِ school_wallets + ردیفِ school_wallet_transactions» با هم commit/rollback می‌شوند و تأییدِ
 * دوباره‌ی همان درخواست اثرِ دوم ندارد (UPDATE شرطیِ موتور فقط یک برنده دارد). فقط `base_amount_rial` شارژ می‌شود، نه پسوندِ یکتاساز.
 * به `wallets`/`wallet_transactions` (کیف‌پولِ شخصی) هرگز دست نمی‌زند. SQL خام روی `client` تا در تراکنشِ موتور بنشیند.
 */
import crypto from "crypto";
import type { ClientLike, PaymentRequestRow } from "./paymentRequests";

export async function schoolWalletTopupEffect(c: ClientLike, request: PaymentRequestRow): Promise<void> {
  const { rows: pr } = await c.query("SELECT school_id FROM payment_requests WHERE id = $1", [request.id]);
  const schoolId: string | null = pr[0]?.school_id ?? null;
  if (!schoolId) throw new Error("school_wallet_topup request has no school_id");
  const amt = request.baseAmountRial;
  if (!Number.isSafeInteger(amt) || amt <= 0) throw new Error("credit amount must be a positive integer (Rial)");
  await c.query("INSERT INTO school_wallets (school_id, balance) VALUES ($1, 0) ON CONFLICT (school_id) DO NOTHING", [schoolId]);
  const { rows } = await c.query(
    "UPDATE school_wallets SET balance = balance + $2, updated_at = NOW() WHERE school_id = $1 RETURNING balance", [schoolId, amt]);
  if (!rows[0]) throw new Error("school wallet row missing after ensure");
  const by = request.confirmedBy === "admin" ? "تأییدِ دستیِ ادمین" : "تأییدِ خودکار با پیامک بانک";
  await c.query(
    `INSERT INTO school_wallet_transactions (id, school_id, type, amount, balance_after, description, ref_id, created_by_user_id)
     VALUES ($1, $2, 'credit', $3, $4, $5, $6, $7)`,
    [crypto.randomUUID(), schoolId, amt, Number(rows[0].balance), `شارژ کیف پول مدرسه — ${by} (درخواست ${request.id})`, request.id, request.userId]);
  await c.query(
    `UPDATE payment_requests SET effect_claimed_at = NOW(), effect_done_at = NOW()
      WHERE id = $1 AND status = 'confirmed' AND effect_claimed_at IS NULL`,
    [request.id]);
}
