import { useLanguage } from "@/hooks/use-language";
import type { Lang } from "@/lib/i18n";
import { useSyncExternalStore } from "react";
import {
  getFallbackLocale,
  getLocale,
  localesVersion,
  subscribeLocales,
  type LocaleData,
} from "@/locales/registry";

export type LocaleShape = LocaleData;
export type Namespace = keyof LocaleShape;

// NOTE [perf]: the five locale files used to be static imports right here,
// which inlined all 744 kB of them into the main entry chunk (see
// locales/registry.ts). They are now lazily loaded per language; main.tsx
// awaits the current language + English before the first render, so these
// two reads are still plain synchronous property lookups.

/**
 * useT(namespace): کلیدهای همون namespace رو برای زبان جاری برمی‌گردونه.
 * اگه کلیدی توی زبون انتخاب‌شده خالی/نبود، fallback به انگلیسی می‌زنه
 * (نه استرینگ خام کلید، نه undefined) و توی dev mode یه warning می‌ده.
 *
 * استفاده:
 *   const t = useT("landing");
 *   t.signIn // -> "Sign In" / "ورود" / ...
 */
export function useT<N extends Namespace>(namespace: N): LocaleShape[N] {
  const { lang } = useLanguage();
  // Locale chunks load asynchronously; re-render when one lands so a late
  // English fallback (see locales/registry.ts) doesn't leave stale strings.
  useSyncExternalStore(subscribeLocales, localesVersion, localesVersion);

  const current = (getLocale(lang)?.[namespace] ?? {}) as Partial<LocaleShape[N]>;
  const fallback = (getFallbackLocale()?.[namespace] ?? {}) as LocaleShape[N];

  // merge: هر کلیدی که توی زبون جاری خالی/گم بود از انگلیسی پر می‌شه.
  const merged = { ...fallback, ...stripEmpty(current) } as LocaleShape[N];

  if (import.meta.env?.DEV) {
    for (const key of Object.keys(fallback as object)) {
      if (!(key in (current as object)) || (current as any)[key] === "") {
        // eslint-disable-next-line no-console
        console.warn(`[i18n] missing key "${String(key)}" in namespace "${String(namespace)}" for lang "${lang}" — falling back to English.`);
      }
    }
  }

  return merged;
}

function stripEmpty<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== "" && v !== undefined && v !== null) (out as any)[k] = v;
  }
  return out;
}
