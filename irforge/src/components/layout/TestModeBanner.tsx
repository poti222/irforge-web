import { useSyncExternalStore } from "react";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import { setAuthToken } from "@/lib/auth-token";
import { getStashedSuperToken, clearStashedSuperToken } from "@/lib/super-stash";

/**
 * components/layout/TestModeBanner.tsx — `/super` بخشِ C (بندِ ۳).
 *
 * تا وقتی یک توکنِ سوپرادمینِ استک‌شده وجود دارد (یعنی سوپرادمین از `/super`
 * «وارد یک هویتِ آزمایشی» شده)، این بنر همیشه دیده می‌شود — این شبکه‌ی
 * ایمنی‌ای است که جلویِ «گیرکردن» در یک حسابِ تست را می‌گیرد.
 */
function subscribe(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

export function TestModeBanner() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  // localStorage تغییرِ همین تب را با "storage" اعلام نمی‌کند (فقط تب‌های
  // دیگر) — پس snapshot هر رندر مستقیم خوانده می‌شود؛ کافی است چون این بنر
  // فقط بعد از یک navigate کامل (window.location.href در enter()) دیده
  // می‌شود، نه در وسطِ یک رندرِ SPA.
  const stashed = useSyncExternalStore(subscribe, getStashedSuperToken, () => null);

  if (!stashed) return null;

  function restore() {
    setAuthToken(stashed as string);
    clearStashedSuperToken();
    window.location.href = "/super";
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm">
      <span className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
        <FlaskConical className="size-4 shrink-0" />
        {fa ? "حالت تست — شما وارد یک حساب آزمایشی شده‌اید" : "Test mode — you're inside a test account"}
      </span>
      <Button size="sm" variant="outline" className="shrink-0 border-amber-500/50" onClick={restore}>
        {fa ? "بازگشت به حساب من" : "Back to my account"}
      </Button>
    </div>
  );
}
