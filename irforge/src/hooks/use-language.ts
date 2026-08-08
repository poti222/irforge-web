import { useCallback, useSyncExternalStore } from "react";
import { navigate } from "wouter/use-browser-location";
import { useRunViewTransition } from "./use-view-transition";
import { type Lang, DEFAULT_LANG, LANGUAGES, isRtlLang, isValidLang } from "@/lib/i18n";
import { langHref, splitLangPrefix } from "@/lib/lang-routing";

// برای سازگاری با کدهای قدیمی که Lang رو از همینجا import می‌کردن
export type { Lang };

const STORAGE_KEY = "irforge_lang";
const SWEEP_MS = 280; // W3: noticeably longer than W2's default UI timing so the RTL/LTR flip doesn't flash

function applyLangAttributes(lang: Lang) {
  const html = document.documentElement;
  html.setAttribute("lang", lang);
  html.setAttribute("dir", isRtlLang(lang) ? "rtl" : "ltr");
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch (_) {}
}

/**
 * زبانِ رندر **فقط** از روی URL تعیین می‌شه.
 *
 * قبلاً اگه URL پیشوند نداشت، انتخاب ذخیره‌شده رو برمی‌گردوند — و همین یه باگ
 * جدی می‌ساخت: زبان، `base` روتر رو تعیین می‌کنه، پس کاربری که قبلاً انگلیسی
 * انتخاب کرده بود و بعد به `/` سر می‌زد، base=/en می‌گرفت در حالی که URL
 * پیشوند نداشت؛ wouter هیچ روتی رو match نمی‌کرد و **صفحه سفید** می‌شد.
 *
 * حالا: پیشوند هست → همون زبان، نیست → زبان ریشه. اینطوری base و URL هیچ‌وقت
 * نمی‌تونن با هم اختلاف داشته باشن. انتخاب ذخیره‌شده از بین نمی‌ره — توی
 * useStoredLangRedirect (در App.tsx) کاربر رو به URL زبان خودش می‌فرسته.
 */
function readInitialLang(): Lang {
  if (typeof window !== "undefined") {
    const fromUrl = splitLangPrefix(window.location.pathname).lang;
    if (fromUrl) return fromUrl;
  }
  return DEFAULT_LANG;
}

/** انتخاب ذخیره‌شده‌ی کاربر (اگه معتبر باشه) — فقط برای ریدایرکت. */
export function readStoredLang(): Lang | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isValidLang(stored) ? stored : null;
  } catch (_) {
    return null;
  }
}

// FIX [refresh-bug]: useLanguage() قبلاً هر بار که یه کامپوننت صداش می‌زد یه
// useState محلی و مستقل می‌ساخت. یعنی وقتی LanguageSwitcher زبان رو عوض
// می‌کرد، فقط استیت خودِ همون کامپوننت آپدیت می‌شد — بقیه‌ی کامپوننت‌هایی که
// جدا useLanguage/useT صدا زده بودن (که تقریباً همه‌ی صفحات هستن) از این
// تغییر خبردار نمی‌شدن، چون هیچ استیت مشترکی بینشون نبود. localStorage و
// attribute های <html> فوری عوض می‌شدن، ولی متن واقعی صفحه فقط با رفرش
// (mount دوباره و خوندن دوباره‌ی localStorage) به‌روز می‌شد.
//
// راه‌حل: یه store مشترک بیرون از React، با useSyncExternalStore بین همه‌ی
// کامپوننت‌ها sync می‌شه. API این هوک دقیقاً همون قبلیه (lang/setLang/
// toggleLang/isRtl) — نیازی به تغییر توی جاهایی که ازش استفاده می‌کنن نیست.
let currentLang: Lang = readInitialLang();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return currentLang;
}

function commitLang(next: Lang) {
  applyLangAttributes(next);
  currentLang = next;
  listeners.forEach((listener) => listener());
}

/**
 * SSG only. Sets the language for a server render without touching document
 * or localStorage (neither exists in Node). The prerender script calls this
 * once per language before renderToString.
 */
export function setRenderLang(next: Lang) {
  currentLang = next;
}

export function useLanguage() {
  // third arg = server snapshot; during the build-time render there's no
  // subscription, the language is whatever setRenderLang() put in the store
  const lang = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const runViewTransition = useRunViewTransition();

  const setLang = useCallback(
    (next: Lang) => {
      // The URL carries the language, so switching language is a navigation:
      // strip whatever prefix the current path has and re-apply the new one.
      // Without this the content would change but the URL (and therefore the
      // canonical/hreflang the page advertises) would still claim the old
      // language.
      const target =
        typeof window === "undefined"
          ? null
          : langHref(next, splitLangPrefix(window.location.pathname).path) +
            window.location.search +
            window.location.hash;

      // W3: crossfade+scale the page across every language flip
      // (including RTL<->LTR when fa/ar are involved) instead of an instant flash.
      runViewTransition(
        () => {
          commitLang(next);
          // same tick as commitLang so React batches them into one render —
          // the router base and the URL must never disagree, even briefly
          if (target) navigate(target);
        },
        () => {
          document.documentElement.animate(
            { opacity: [1, 0], transform: ["scale(1)", "scale(0.98)"] },
            { duration: SWEEP_MS, easing: "ease-in", pseudoElement: "::view-transition-old(root)" } as any
          );
          document.documentElement.animate(
            { opacity: [0, 1], transform: ["scale(1.02)", "scale(1)"] },
            { duration: SWEEP_MS, easing: "ease-out", pseudoElement: "::view-transition-new(root)" } as any
          );
        }
      );
    },
    [runViewTransition]
  );

  // باقی مونده برای سازگاری با جاهایی که هنوز toggleLang صدا می‌زنن —
  // به‌جای فقط fa<->en، حالا بین هر ۵ زبان به‌ترتیب می‌چرخه.
  // در فاز بعدی همه‌ی این جاها با LanguageSwitcher جایگزین می‌شن.
  const toggleLang = useCallback(() => {
    const idx = LANGUAGES.findIndex((l) => l.code === lang);
    const next = LANGUAGES[(idx + 1) % LANGUAGES.length].code;
    setLang(next);
  }, [lang, setLang]);

  return { lang, setLang, toggleLang, isRtl: isRtlLang(lang) };
}
