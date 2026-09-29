/**
 * lib/smsParsers/index.ts — ثبتِ پارسرها به‌ازای `payment_channels.bank_parser`.
 * نامِ ناشناخته → `generic` (محافظه‌کار)، نه خطا و نه حدس.
 */
import { parseBlubankSms } from "./blubank";
import { parseGenericSms } from "./generic";
import type { SmsParser } from "./types";

export * from "./types";
export { normalizeSmsText } from "./normalize";
export { parseBlubankSms, parseGenericSms };

const PARSERS: Record<string, SmsParser> = {
  blubank: parseBlubankSms,
  generic: parseGenericSms,
};

export function getSmsParser(name: string | null | undefined): SmsParser {
  return PARSERS[String(name ?? "").toLowerCase()] ?? parseGenericSms;
}

export const KNOWN_SMS_PARSERS = Object.keys(PARSERS);
