/**
 * lib/smsParsers/generic.ts — پارسرِ عمومی برایِ بانک‌هایی که پارسرِ اختصاصی
 * ندارند. عمداً **محافظه‌کار** است: هر ابهامی → `unknown` (هرگز match نمی‌شود)،
 * چون یک تأییدِ اشتباه پول است ولی یک عدمِ‌تشخیص فقط مسیرِ فیش را فعال می‌کند.
 *
 * قواعد:
 *  - جهت: کلماتِ واریز و کلماتِ برداشت هرکدام جدا شمرده می‌شوند؛ اگر هر دو
 *    (یا هیچ‌کدام) بود → unknown.
 *  - مبلغ: فقط عددی که **واحدِ صریح** دارد (ریال/تومان/IRR/IRT). عددِ بی‌واحد
 *    هرگز حدس زده نمی‌شود (۱۰× خطا). «موجودی/مانده» قبل از استخراج حذف می‌شود.
 *    اگر بیش از یک مبلغِ متمایز ماند → مبهم → null.
 *  - تومان × ۱۰ = ریال.
 */
import { NUM, normalizeSmsText, toInt } from "./normalize";
import { finalize, UNPARSED, type ParsedSms } from "./types";

const UNIT = String.raw`(ریال|تومان|IRR|IRT)`;
const DEPOSIT_WORDS = /واریز|واریزی|دریافت|افزایش\s*موجودی|بستانکار|\bdeposit\b|\bcredit(?:ed)?\b/i;
const WITHDRAW_WORDS = /برداشت|کسر|خرید|پرداخت|بدهکار|انتقال\s*از|\bwithdraw(?:al)?\b|\bdebit(?:ed)?\b|\bpurchase\b/i;

const BALANCE_CLAUSE = new RegExp(
  String.raw`(?:موجودی|مانده)(?:\s*(?:فعلی|حساب|قابل\s*برداشت))?\s*[:：]?\s*${NUM}\s*${UNIT}?`, "gi",
);
const AMOUNT_A = new RegExp(String.raw`${NUM}\s*${UNIT}`, "gi");
// «ریال: 500,000» (برچسب‌وار) — بدونِ «:» نه، وگرنه «ریال 21:11» ساعت را مبلغ می‌گیرد.
const AMOUNT_B = new RegExp(String.raw`${UNIT}\s*[:：]\s*${NUM}`, "gi");

function toRial(value: number, unit: string): number {
  return /^(تومان|IRT)$/i.test(unit) ? value * 10 : value;
}

export function parseGenericSms(rawText: string): ParsedSms {
  const text = normalizeSmsText(rawText);
  if (!text) return UNPARSED;

  let balanceRial: number | null = null;
  const balanceMatch = new RegExp(BALANCE_CLAUSE.source, "i").exec(text);
  if (balanceMatch) {
    const v = toInt(balanceMatch[1]);
    if (v !== null && balanceMatch[2]) balanceRial = toRial(v, balanceMatch[2]);
  }

  const withoutBalance = text.replace(BALANCE_CLAUSE, " ");
  const isDeposit = DEPOSIT_WORDS.test(withoutBalance);
  const isWithdraw = WITHDRAW_WORDS.test(withoutBalance);
  const direction = isDeposit && !isWithdraw ? "deposit" : isWithdraw && !isDeposit ? "withdraw" : "unknown";

  const amounts = new Set<number>();
  for (const m of withoutBalance.matchAll(AMOUNT_A)) {
    const v = toInt(m[1]);
    if (v !== null) amounts.add(toRial(v, m[2]));
  }
  for (const m of withoutBalance.matchAll(AMOUNT_B)) {
    const v = toInt(m[2]);
    if (v !== null) amounts.add(toRial(v, m[1]));
  }
  const amountRial = amounts.size === 1 ? [...amounts][0] : null;

  return finalize(direction, amountRial, balanceRial);
}
