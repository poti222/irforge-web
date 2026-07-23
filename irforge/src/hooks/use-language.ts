import { useCallback, useSyncExternalStore } from "react";
import { useRunViewTransition } from "./use-view-transition";
import { type Lang, DEFAULT_LANG, LANGUAGES, isRtlLang, isValidLang } from "@/lib/i18n";

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

function readInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    // زبان پیش‌فرض سایت: انگلیسی — تا وقتی کاربر خودش چیز دیگه‌ای انتخاب نکرده
    return isValidLang(stored) ? stored : DEFAULT_LANG;
  } catch (_) {
    return DEFAULT_LANG;
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

export function useLanguage() {
  const lang = useSyncExternalStore(subscribe, getSnapshot);
  const runViewTransition = useRunViewTransition();

  const setLang = useCallback(
    (next: Lang) => {
      // W3: crossfade+scale the page across every language flip
      // (including RTL<->LTR when fa/ar are involved) instead of an instant flash.
      runViewTransition(
        () => {
          commitLang(next);
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
