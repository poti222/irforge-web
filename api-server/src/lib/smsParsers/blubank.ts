/**
 * lib/smsParsers/blubank.ts — پیامکِ بلوبانک.
 *
 * قالبِ واریز (نمونه‌ی واقعی):
 *   بلو / واریز پول / «<نام> عزیز، 1,000,000 ریال به حساب شما نشست.» /
 *   «موجودی: 1,068,654 ریال» / ساعت / تاریخ
 * قالبِ برداشت: «<نام> عزیز، 500,000 ریال از حساب شما برداشت شد.»
 *
 * نامِ صاحبِ حساب عمداً در الگو نیست (داده‌ی متغیر است). مبلغِ واریز همیشه
 * همان عددِ مقابلِ «ریال به حساب شما نشست» است، **هرگز** عددِ «موجودی» —
 * موجودی فقط اطلاعاتی برگردانده می‌شود.
 */
import { NUM, normalizeSmsText, toInt } from "./normalize";
import { finalize, UNPARSED, type ParsedSms } from "./types";

const BALANCE_RE = new RegExp(String.raw`(?:موجودی|مانده)(?:\s*(?:فعلی|حساب))?\s*[:：]?\s*${NUM}\s*ریال`);
const DEPOSIT_RE = new RegExp(String.raw`${NUM}\s*ریال\s*به\s*حساب\s*شما\s*نشست`);
// «۲۲۹,۴۶۰ ریال [بابت خرید …] از حساب شما (برداشت شد | کسر شد | پرید | کم شد)». عددِ «موجودی» هرگز اینجا نمی‌نشیند
// (بعد از آن «از حساب شما» نمی‌آید).
const WITHDRAW_RE = new RegExp(String.raw`${NUM}\s*ریال\s*(?:[^.\n]{0,80}?\s)?از\s*حساب\s*شما\s*(?:برداشت|کسر|پرید|کم\s*شد)`);

export function parseBlubankSms(rawText: string): ParsedSms {
  const text = normalizeSmsText(rawText);
  if (!text) return UNPARSED;

  const balance = toInt(text.match(BALANCE_RE)?.[1]);
  const deposit = /واریز/.test(text) ? text.match(DEPOSIT_RE) : null;
  const withdraw = text.match(WITHDRAW_RE);
  const withdrawWord = /برداشت|کسر\s*از|از\s*حساب\s*شما\s*(?:پرید|کم\s*شد)|بابت\s*خرید/.test(text);

  // هر دو علامت هم‌زمان → مبهم؛ هرگز حدس نمی‌زنیم.
  if (deposit && (withdraw || withdrawWord)) return finalize("unknown", null, balance);
  if (deposit) return finalize("deposit", toInt(deposit[1]), balance);
  if (withdraw || withdrawWord) return finalize("withdraw", toInt(withdraw?.[1]), balance);
  return finalize("unknown", null, balance);
}
