import type { Lang } from "@/hooks/use-language";

/**
 * lib/digits.ts — IRFORGE_PROMPT_V3 Phase 40 (input hygiene).
 * ─────────────────────────────────────────────────────────────────────────────
 * Every money-amount field on the site used to be a native
 * `<input type="number">`. That works fine for a Latin keyboard, but a
 * Persian- or Arabic-keyboard user's digit keys produce ۰-۹ / ٠-٩, and a
 * native number input silently REJECTS those keystrokes outright — nothing
 * gets typed, with no error, until the visitor thinks to switch keyboard
 * layout. `foldDigits`/`digitsOnly` turn those into plain ASCII so a text
 * input can accept them; `groupAmount` re-adds locale-aware thousands
 * separators so a seven-digit Toman amount stays readable while typing.
 * See components/ui/amount-input.tsx for the input that wires these together.
 */

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Any digit character across ASCII, Persian and Arabic-Indic — for cursor math. */
export const ANY_DIGIT_RE = /[0-9۰-۹٠-٩]/;

/** Converts Persian and Arabic-Indic digits in `input` to plain ASCII. Leaves everything else untouched. */
export function foldDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const p = PERSIAN_DIGITS.indexOf(ch);
    if (p !== -1) { out += String(p); continue; }
    const a = ARABIC_INDIC_DIGITS.indexOf(ch);
    if (a !== -1) { out += String(a); continue; }
    out += ch;
  }
  return out;
}

/** Folds digits, then strips everything that isn't an ASCII digit (separators, spaces, pasted currency symbols, ...). */
export function digitsOnly(input: string): string {
  return foldDigits(input).replace(/[^0-9]/g, "");
}

/**
 * A clean ASCII digit string (as produced by `digitsOnly`, or a plain
 * `number`) formatted for display with locale thousands-grouping — Persian
 * digits for `fa`, Latin digits otherwise. Toman amounts are always whole
 * numbers in this codebase (see formatToman's Math.round), so this is
 * integer-only by design; a leading run of zeros is trimmed the way a person
 * would expect ("0120" while typing "0" then "120" reads as "120", not "0,120").
 */
export function groupAmount(raw: string | number, lang: Lang): string {
  const digits = typeof raw === "number" ? String(Math.round(raw)) : digitsOnly(raw);
  const trimmed = digits.replace(/^0+(?=\d)/, "");
  if (!trimmed) return "";
  const locale = lang === "fa" ? "fa-IR" : "en-US";
  return Number(trimmed).toLocaleString(locale);
}
