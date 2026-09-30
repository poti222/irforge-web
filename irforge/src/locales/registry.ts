import type { Lang } from "@/lib/i18n";

/**
 * One place that owns the locale JSON files.
 *
 * NOTE [perf]: `use-translation.ts`, `lib/faq-content.ts` and
 * `lib/learn-content.ts` each used to do a static
 * `import en from "@/locales/en.json"` … times five. The five files are
 * 744 kB of JSON combined, and because the landing page is statically imported
 * (SSG prerenders it), ALL FIVE were inlined into the main entry chunk. A
 * Persian visitor downloaded Arabic, Turkish and Russian copy — ~450 kB of raw
 * JSON they can never see — before the page could render.
 *
 * Now each language is its own lazily-imported chunk. The boot sequence in
 * main.tsx awaits only the language in the URL plus English (the fallback
 * layer that fills gaps in a partially-translated locale), and
 * scripts/ssg.mjs writes a <link rel="modulepreload"> for exactly those two
 * chunks into each prerendered page, so awaiting them costs no waterfall —
 * the browser starts fetching them from the HTML, in parallel with the entry.
 *
 * The build-time render has no network and must be synchronous, so
 * entry-ssg.tsx statically imports all five and calls seedLocales() once.
 */

/** Shape of a locale file. Type-only, so this does NOT pull en.json into the graph. */
export type LocaleData = typeof import("@/locales/en.json");

/**
 * بخشِ "/schools" فاز ۱ — طبقِ تصمیمِ صریحِ کاربر، فقط fa/en کلیدهای
 * namespace «schools» را دارند؛ ar/ru/tr عمداً دست‌نخورده می‌مانند و از
 * fallbackِ انگلیسیِ همینِ useT (که از قبل وجود داشت) استفاده می‌کنند. پس
 * دیگر نمی‌شود فرض کرد هر locale دقیقاً شکلِ کاملِ `LocaleData` را دارد —
 * لودر و خواندنش را روی `Partial<LocaleData>` تعریف می‌کنیم (مصرف‌کننده‌ها
 * از قبل، چه در useT چه در faq-content/learn-content، با `?? {}`/`as any`
 * برای کلیدِ گمشده آماده بودند).
 */
const loaders: Record<Lang, () => Promise<{ default: Partial<LocaleData> }>> = {
  en: () => import("@/locales/en.json"),
  fa: () => import("@/locales/fa.json"),
  ar: () => import("@/locales/ar.json"),
  tr: () => import("@/locales/tr.json"),
  ru: () => import("@/locales/ru.json"),
};

const loaded: Partial<Record<Lang, Partial<LocaleData>>> = {};

// Bumped whenever a locale lands, so useT() can re-render the tree when the
// English fallback arrives after the first paint (see ensureLocales below).
let version = 0;
const listeners = new Set<() => void>();

export function subscribeLocales(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function localesVersion(): number {
  return version;
}

function announce() {
  version += 1;
  listeners.forEach((l) => l());
}

/** Empty stand-in so a caller that races the load reads `{}`, never crashes. */
const EMPTY = {} as Partial<LocaleData>;

/** SSG only: hand the registry the statically-imported locales up front. */
export function seedLocales(entries: Partial<Record<Lang, Partial<LocaleData>>>): void {
  Object.assign(loaded, entries);
}

/** Synchronous read. Safe to call during render *after* ensureLocales(lang). */
export function getLocale(lang: Lang): Partial<LocaleData> {
  return loaded[lang] ?? loaded.en ?? EMPTY;
}

/** The English fallback layer, or `{}` if it somehow hasn't landed yet. */
export function getFallbackLocale(): Partial<LocaleData> {
  return loaded.en ?? EMPTY;
}

export function isLocaleLoaded(lang: Lang): boolean {
  return Boolean(loaded[lang]);
}

async function ensureOne(lang: Lang): Promise<void> {
  if (loaded[lang]) return;
  const mod = await loaders[lang]();
  // JSON modules expose the object on .default; be tolerant of either shape.
  loaded[lang] = ((mod as any).default ?? mod) as Partial<LocaleData>;
  announce();
}

/**
 * Load what a render in `lang` needs before the first paint: just that one
 * language.
 *
 * English is deliberately NOT awaited. It exists as a fallback layer for keys
 * a partially-translated locale is missing, and today every locale is complete
 * — so blocking the first render on another ~35 kB (gzipped) that changes
 * nothing on screen would be pure latency. It is fetched in the background
 * instead, and `announce()` re-renders through useT()'s subscription if it
 * turns out to have filled a gap.
 */
export function ensureLocales(lang: Lang): Promise<void> {
  if (lang !== "en") {
    // fire-and-forget; a failure here just means no fallback layer
    void ensureOne("en").catch(() => {});
  }
  return ensureOne(lang);
}
