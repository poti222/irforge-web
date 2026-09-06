/**
 * lib/walletTopupService.ts — شارژِ کیف‌پول با یک لینکِ بازِ بلوبانک + تشخیصِ
 * خودکارِ پیامکِ واریزی.
 * ─────────────────────────────────────────────────────────────────────────────
 * فقط یک لینکِ پرداختِ مبلغ‌باز وجود دارد (نه یک لینک به‌ازای هر مبلغِ ثابت)
 * — کاربر خودش عدد را در صفحه‌ی بلوبانک تایپ می‌کند. چون لینک باز است، دو
 * سفارشِ هم‌زمان با یک مبلغِ یکسان ممکن است پیش بیایند و پیامکِ بانکی
 * نتواند بگوید مالِ کدام‌شان است. راه‌حل نوبت‌دهی/صف نیست (که یعنی فقط یک
 * سفارش در لحظه مجاز باشد) — هر سفارش یک پسوندِ سه‌رقمیِ تصادفی می‌گیرد و
 * کاربر دقیقاً `finalAmount = requestedAmount + suffix` را وارد می‌کند.
 * یکتاییِ `finalAmount` بینِ سفارش‌های `pending` با یک ایندکسِ جزئی در
 * دیتابیس enforce می‌شود (`wallet_topups_pending_final_amount_uk`،
 * migrate.mjs)؛ `requestTopup` روی خطای یکتاییِ پستگرس (`23505`) دوباره یک
 * پسوندِ دیگر امتحان می‌کند.
 *
 * به کیف‌پول همیشه `requestedAmount` واریز می‌شود، نه `finalAmount` — پسوند
 * فقط برای تطبیقِ پیامک است، جزوِ پولِ واقعیِ کاربر نیست.
 *
 * IRFORGE_RIAL_MIGRATION Phase 2: `wallet_topups.requestedAmount`/`.suffix`/
 * `.finalAmount` are Rial now (this module's public constants —
 * `MIN_TOPUP_AMOUNT`, `MAX_TOPUP_AMOUNT`, `PRESET_TOPUP_AMOUNTS` — stay
 * Toman, since that's what the customer-facing topup UI shows). `amt` is
 * validated against those Toman bounds, then converted to Rial exactly once,
 * before the suffix/finalAmount/insert — everything downstream of that point
 * in this module is Rial, matching the bank SMS it will eventually be
 * matched against (`parseBlubankDepositSms()` below).
 */
import crypto from "crypto";
import { db, walletTopupsTable, type WalletTopup } from "@workspace/db";
import { and, eq, lt } from "drizzle-orm";
import { tomanToRial } from "./currency.js";

export const TOPUP_EXPIRY_MS = 20 * 60 * 1000;
export const MIN_TOPUP_AMOUNT = 10_000;
export const MAX_TOPUP_AMOUNT = 50_000_000;
/** پیشنهادهای مبلغ در رابط کاربری — صرفاً پیش‌فرض، کاربر می‌تواند دلخواه هم بزند. */
export const PRESET_TOPUP_AMOUNTS = [50_000, 100_000, 200_000, 500_000, 1_000_000];

const MAX_SUFFIX_ATTEMPTS = 25;
const POSTGRES_UNIQUE_VIOLATION = "23505";

export class InvalidTopupAmountError extends Error {}
export class TopupSuffixExhaustedError extends Error {}

/** Rial-scale nonce (was 100..999 Toman before Phase 2 — same 3-digit shape, ×10). */
function randomSuffix(): number {
  return 1000 + crypto.randomInt(9000); // 1000..9999 Rial
}

/** یک سفارشِ تازه با `finalAmount` یکتا در بینِ سفارش‌های `pending` می‌سازد. */
export async function requestTopup(userId: string, requestedAmount: number): Promise<WalletTopup> {
  const amt = Math.round(Number(requestedAmount) || 0);
  if (!Number.isFinite(amt) || amt < MIN_TOPUP_AMOUNT || amt > MAX_TOPUP_AMOUNT) {
    throw new InvalidTopupAmountError(
      `مبلغ باید بینِ ${MIN_TOPUP_AMOUNT.toLocaleString("fa-IR")} و ${MAX_TOPUP_AMOUNT.toLocaleString("fa-IR")} تومان باشد.`,
    );
  }
  const amtRial = tomanToRial(amt);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOPUP_EXPIRY_MS);

  for (let attempt = 0; attempt < MAX_SUFFIX_ATTEMPTS; attempt++) {
    const suffix = randomSuffix();
    const finalAmount = amtRial + suffix;
    try {
      const [row] = await db.insert(walletTopupsTable).values({
        id: crypto.randomUUID(),
        userId,
        requestedAmount: amtRial,
        suffix,
        finalAmount,
        status: "pending",
        createdAt: now,
        expiresAt,
      }).returning();
      return row;
    } catch (err: any) {
      // برخوردِ finalAmount با یک سفارشِ pending دیگر — یک پسوندِ دیگر امتحان کن.
      if (err?.code === POSTGRES_UNIQUE_VIOLATION) continue;
      throw err;
    }
  }
  throw new TopupSuffixExhaustedError("امکانِ ساختِ سفارشِ شارژِ یکتا وجود نداشت، لطفاً دوباره تلاش کنید.");
}

export async function getTopupForUser(userId: string, requestId: string): Promise<WalletTopup | null> {
  const [row] = await db.select().from(walletTopupsTable)
    .where(and(eq(walletTopupsTable.id, requestId), eq(walletTopupsTable.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** فقط یک سفارشِ هنوز `pending` را کاربر خودش می‌تواند لغو کند. */
export async function cancelTopup(userId: string, requestId: string): Promise<WalletTopup | null> {
  const [row] = await db.update(walletTopupsTable)
    .set({ status: "canceled" })
    .where(and(
      eq(walletTopupsTable.id, requestId),
      eq(walletTopupsTable.userId, userId),
      eq(walletTopupsTable.status, "pending"),
    ))
    .returning();
  return row ?? null;
}

/**
 * سفارش‌های `pending`ی که مهلت‌شان گذشته را `expired` می‌کند تا `finalAmount`
 * آزاد شود (ایندکسِ یکتا فقط روی `status = 'pending'` است). هیچ زیرساختِ
 * جدیدِ cron لازم نیست — دقیقاً همان الگویِ `refreshExchangeRateFromApi` در
 * index.ts (یک `setInterval`، بدونِ job جداگانه روی Railway).
 */
export async function expireStaleTopups(): Promise<number> {
  const rows = await db.update(walletTopupsTable)
    .set({ status: "expired" })
    .where(and(
      eq(walletTopupsTable.status, "pending"),
      lt(walletTopupsTable.expiresAt, new Date()),
    ))
    .returning({ id: walletTopupsTable.id });
  return rows.length;
}

export type ParsedBlubankSms = { amountRial: number };

/**
 * پیامکِ واریزیِ بلوبانک را پارس می‌کند. فقط ساختارِ عبارت را می‌شناسد
 * («عددِ لاتین با کاما + ریال + به حساب شما نشست») — نامِ صاحبِ حساب
 * («فاطمه عزیز، ...») عمداً در الگو نیست، چون داده‌ی متغیر است، نه بخشی از
 * قالبِ ثابتِ پیام.
 *
 * IRFORGE_RIAL_MIGRATION Phase 2: بانک مبلغ را به **ریال** می‌فرستد، و حالا
 * دقیقاً همان عددِ ریال برمی‌گردد — بدونِ هیچ تبدیلی. قبلاً اینجا بر ۱۰
 * تقسیم می‌شد تا با `wallet_topups`ی تومانی مقایسه شود
 * (`Math.round(amountRial / 10)`)، که برایِ مبلغ‌هایِ غیرگرد گمکننده بود
 * (مثلاً یک پیامکِ واقعی: «۲,۷۶۸,۶۵۴ ریال» → ۲۷۶,۸۶۵ تومان، و ۲۷۶,۸۶۵×۱۰ =
 * ۲,۷۶۸,۶۵۰ ≠ ۲,۷۶۸,۶۵۴ — دقیقاً همین شکافِ ۴ ریالی باعث می‌شد
 * `finalAmount` هیچ‌وقت با مقدارِ پارس‌شده برابر نشود). حالا که
 * `wallet_topups.finalAmount` هم ریال است، این مقایسه دقیق و بدون افتِ
 * دقت است.
 */
export function parseBlubankDepositSms(rawText: string): ParsedBlubankSms | null {
  const text = String(rawText ?? "");
  if (!/واریز/.test(text)) return null; // پیامکِ برداشت یا نوعِ دیگر — نادیده بگیر
  const m = text.match(/([\d,]+)\s*ریال\s*به\s*حساب\s*شما\s*نشست/);
  if (!m) return null;
  const amountRial = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(amountRial) || amountRial <= 0) return null;
  return { amountRial };
}
