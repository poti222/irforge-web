/**
 * scroll-to-top.tsx — هر صفحه‌ی تازه از بالا شروع می‌شود.
 *
 * مشکلی که حل می‌کند: هیچ‌جای این اپ اسکرول را مدیریت نمی‌کرد. رفتن به یک صفحه‌ی
 * جدید موقعیت اسکرول صفحه‌ی قبل را نگه می‌داشت (اگر پایین بودی، صفحه‌ی بعد هم
 * از وسط/پایین باز می‌شد) و رفرش هم همان‌جایی برمی‌گشت که بودی.
 *
 * ⚠️ **دو ظرف اسکرول جدا وجود دارد** و همین نکته‌ی اصلی این فایل است:
 *
 *   - صفحه‌های عمومی (لندینگ، /pricing، /learn) روی **window** اسکرول می‌کنند.
 *   - صفحه‌های داشبورد داخل `<main className="flex-1 overflow-auto">` اسکرول
 *     می‌کنند (App.tsx:122) — یعنی `window.scrollTo` روی آن‌ها **هیچ اثری
 *     ندارد** و باید خودِ آن عنصر صفر شود.
 *
 * پس هر دو ریست می‌شوند.
 *
 * `history.scrollRestoration = "manual"`: مرورگر به‌طور پیش‌فرض موقع رفرش و
 * back موقعیت اسکرول را برمی‌گرداند. برای رفرش دقیقاً همان چیزی است که کاربر
 * شکایت داشت، پس خاموشش می‌کنیم.
 *
 * لینک لنگرداری (`/page#section`) عمداً مستثناست: کسی که روی یک لینک با هش
 * کلیک کرده، *می‌خواهد* وسط صفحه بیفتد و بردنش به بالا خرابکاری است.
 */
import { useEffect, useLayoutEffect } from "react";
import { useLocation } from "wouter";

/** ظرف‌های اسکرولی که ممکن است محتوای صفحه داخلشان باشد. */
function scrollContainers(): Element[] {
  // `main` پوسته‌ی داشبورد است؛ `[data-scroll-container]` برای هر جای دیگری که
  // بعداً ظرف اسکرول خودش را داشته باشد و بخواهد در این رفتار شریک شود.
  return [
    ...document.querySelectorAll("main"),
    ...document.querySelectorAll("[data-scroll-container]"),
  ];
}

function resetScroll(): void {
  // `instant` و نه `smooth`: این یک انتقال است نه یک حرکت، و اسکرولِ نرم روی
  // تعویض صفحه به‌شکل پرش دیده می‌شود.
  try {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  } catch {
    window.scrollTo(0, 0);
  }
  // بعضی مرورگرها اسکرول را روی documentElement و بعضی روی body نگه می‌دارند.
  if (document.documentElement) document.documentElement.scrollTop = 0;
  if (document.body) document.body.scrollTop = 0;

  for (const element of scrollContainers()) {
    if (element.scrollTop !== 0) element.scrollTop = 0;
    if (element.scrollLeft !== 0) element.scrollLeft = 0;
  }
}

export function ScrollToTop() {
  const [location] = useLocation();

  // یک بار در ابتدا: جلوی بازگردانی خودکار مرورگر روی رفرش را می‌گیرد.
  useEffect(() => {
    if (typeof history !== "undefined" && "scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }
  }, []);

  // useLayoutEffect و نه useEffect: قبل از رنگ‌آمیزی مرورگر اجرا می‌شود، پس
  // کاربر یک فریمِ وسط‌صفحه نمی‌بیند و بعد پرش به بالا.
  useLayoutEffect(() => {
    // لینک لنگردار را به حال خودش بگذار.
    if (typeof window !== "undefined" && window.location.hash) return;

    resetScroll();

    // صفحه‌های این اپ lazy لود می‌شوند (React.lazy + Suspense در App.tsx)، پس
    // در لحظه‌ی تغییر مسیر محتوای واقعی هنوز رندر نشده و ظرف اسکرول ممکن است
    // هنوز وجود نداشته باشد یا ارتفاعش صفر باشد. یک ریست دوم بعد از اولین
    // فریم، همان حالت را می‌گیرد.
    const raf = requestAnimationFrame(resetScroll);
    return () => cancelAnimationFrame(raf);
  }, [location]);

  return null;
}
