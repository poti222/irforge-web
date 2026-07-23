import { useLanguage } from "@/hooks/use-language";
import en from "@/locales/en.json";
import fa from "@/locales/fa.json";
import ar from "@/locales/ar.json";
import tr from "@/locales/tr.json";
import ru from "@/locales/ru.json";

// یک آبجکت واحد که هر ۵ زبان رو نگه می‌داره — استاتیک import شده، بدون
// درخواست شبکه‌ی اضافه (فایل‌های locale کوچیک‌اند، توسط bundler خودِ vite
// در build نهایی inline می‌شن).
const LOCALES = { en, fa, ar, tr, ru } as const;

export type LocaleShape = typeof en;
export type Namespace = keyof LocaleShape;

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

  const current = (LOCALES[lang]?.[namespace] ?? {}) as Partial<LocaleShape[N]>;
  const fallback = LOCALES.en[namespace];

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
