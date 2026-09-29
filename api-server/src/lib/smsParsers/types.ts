/**
 * lib/smsParsers/types.ts — قرارداد مشترکِ پارسرهای پیامک بانک
 * (IRFORGE_CARD_AUTOCONFIRM_PROMPT، فاز ۳).
 *
 * `parsedOk` فقط وقتی true است که **هم جهت مشخص باشد هم مبلغ** — دقیقاً همان
 * شرطی که CHECKِ `sms_inbox_parsed_chk` در دیتابیس دارد. پیامکی که جهتش
 * `unknown` است یا مبلغش استخراج نشد هرگز نباید قابلِ تطبیق باشد.
 */
export type SmsDirection = "deposit" | "withdraw" | "unknown";

export interface ParsedSms {
  direction: SmsDirection;
  /** ریالِ صحیح، یا null اگر استخراج نشد. */
  amountRial: number | null;
  /** «موجودی/مانده» به ریال، یا null. اطلاعاتی است؛ هرگز مبنای تطبیق نیست. */
  balanceRial: number | null;
  parsedOk: boolean;
}

export type SmsParser = (rawText: string) => ParsedSms;

export const UNPARSED: ParsedSms = Object.freeze({
  direction: "unknown", amountRial: null, balanceRial: null, parsedOk: false,
});

export function finalize(direction: SmsDirection, amountRial: number | null, balanceRial: number | null): ParsedSms {
  return {
    direction,
    amountRial,
    balanceRial,
    parsedOk: direction !== "unknown" && amountRial !== null,
  };
}
