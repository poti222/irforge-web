import { getFallbackLocale, getLocale } from "@/locales/registry";
import type { Lang } from "./i18n";

/**
 * The landing FAQ, read from one place by both the page and the schema.
 *
 * This exists because they used to disagree: `FaqSection` rendered a hardcoded
 * `q1..q5` while `faqFor()` in `entry-ssg.tsx` looped to 6. Adding a `q6` to
 * the locales would therefore have put a question into FAQPage schema that the
 * page never rendered — schema without visible content, which is exactly the
 * violation the rest of this codebase is careful to avoid.
 *
 * Now both call `faqEntries()`, which discovers however many `qN`/`aN` pairs
 * exist. Adding `q9`/`a9` to the locale files makes it appear in the rendered
 * page and in the schema with no code change at all.
 */

/** Hard stop so a malformed locale file can't spin forever. */
const MAX_QUESTIONS = 50;

export interface FaqEntry {
  q: string;
  a: string;
}

export function faqEntries(lang: Lang): FaqEntry[] {
  // locales are lazily loaded — see locales/registry.ts
  const ns: Record<string, string> = {
    ...((getFallbackLocale() as any)?.faq ?? {}),
    ...((getLocale(lang) as any)?.faq ?? {}),
  };
  const out: FaqEntry[] = [];
  for (let i = 1; i <= MAX_QUESTIONS; i++) {
    const q = ns[`q${i}`];
    const a = ns[`a${i}`];
    // Stop at the first gap rather than skipping it: a missing q3 with a
    // present q4 means the locale file is wrong, and silently renumbering
    // would hide that.
    if (!q || !a) break;
    out.push({ q, a });
  }
  return out;
}
