import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

/**
 * hooks/use-viewed-school.tsx — بخش "/schools" فاز ۳ (بندِ ۱ از چک‌لیست):
 * «مدرسه‌ی دیده‌شده»ِ سوییچرِ «مدرسه‌های من» را بینِ همه‌یِ صفحاتِ مدیریتیِ
 * مدیر (اعضا/کلاس‌ها/برنامه‌ها/اعلامیه‌ها) به اشتراک می‌گذارد.
 *
 * چرا Context و نه پارامترِ URL (مثلِ الگویِ `/bots/:botId`): آن الگو نیاز
 * داشت همه‌ی روت‌ها زیرِ `/schools/admin/:schoolId/...` بازنویسی شوند —
 * یعنی همزمان App.tsx، school-sidebar.tsx، و لینک‌های داخلیِ هر پنج صفحه.
 * این‌جا سریع‌ترین و کم‌ریسک‌ترین راهی که همان اثر را می‌دهد (سوییچِ مدیر در
 * یک صفحه، همه‌ی صفحاتِ دیگر را هم عوض می‌کند) یک Contextِ سراسری است که
 * SchoolShell آن‌را فراهم می‌کند — بدونِ دست‌زدن به قراردادِ روتینگِ فعلی.
 * اگر فازِ بعدی لینک‌های قابلِ‌اشتراک‌گذاریِ per-school خواست (مثلاً برایِ
 * دیپ‌لینک به مدیریتِ یک مدرسه‌ی خاص)، همین جا جایِ درستی برای مهاجرت به
 * پارامترِ URL است.
 */
const ViewedSchoolContext = createContext<{
  viewedSchoolId: string | null;
  setViewedSchoolId: (id: string | null) => void;
} | null>(null);

const STORAGE_KEY = "schools:viewed-school-id";

/**
 * `/super` — «مدیریتِ کاملِ» یک مدرسه از پنلِ سوپرادمین: مدرسه را قبل از رفتن به /schools/admin انتخاب‌شده می‌گذارد
 * (ViewedSchoolProvider هنگامِ mount همین مقدار را می‌خواند). خطایِ localStorage بی‌اهمیت است.
 */
export function rememberViewedSchool(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // حالتِ خصوصی/بلاک‌شده — فقط یعنی انتخاب به صفحه‌یِ بعد نمی‌رسد؛ سوییچرِ مدرسه همان‌جا هم هست.
  }
}

export function ViewedSchoolProvider({ children }: { children: ReactNode }) {
  const [viewedSchoolId, setViewedSchoolIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const setViewedSchoolId = useCallback((id: string | null) => {
    setViewedSchoolIdState(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage در حالتِ خصوصی/بلاک‌شده ممکن است پرتاب کند — بی‌اهمیت،
      // فقط یعنی انتخاب بینِ رفرش‌ها به‌خاطر نمی‌ماند.
    }
  }, []);

  return (
    <ViewedSchoolContext.Provider value={{ viewedSchoolId, setViewedSchoolId }}>
      {children}
    </ViewedSchoolContext.Provider>
  );
}

/**
 * `fallbackSchoolId` معمولاً `me.schoolId` (عضویتِ اصلیِ کاربر) است — وقتی
 * مدیر هنوز چیزی سوییچ نکرده یا فقط یک مدرسه دارد، همان استفاده می‌شود.
 */
export function useViewedSchoolId(fallbackSchoolId?: string | null): string | undefined {
  const ctx = useContext(ViewedSchoolContext);
  return (ctx?.viewedSchoolId ?? fallbackSchoolId) || undefined;
}

/** برایِ خودِ سوییچر (admin/index.tsx) — هم مقدار و هم setter لازم دارد. */
export function useViewedSchool() {
  const ctx = useContext(ViewedSchoolContext);
  if (!ctx) {
    throw new Error("useViewedSchool must be used within ViewedSchoolProvider (SchoolShell)");
  }
  return ctx;
}

/**
 * مدرسه‌یِ «فعال» برایِ صفحاتِ درس‌ها/محتوا: مدیر (و سوپرادمین) مدرسه‌یِ دیده‌شده از سوییچر را می‌بیند؛
 * بقیه (معلم/دانش‌آموز/والد) همیشه مدرسه‌یِ خودشان — تا یک `viewedSchoolId` ماندهْ در localStorageِ همان
 * مرورگر (مثلاً از نشستِ قبلیِ یک مدیر) برایِ غیرمدیر یک مدرسه‌یِ ناآشنا (۴۰۳/فهرستِ خالی) نسازد.
 * قبلاً این صفحات فقط `me.schoolId` را می‌خواندند: مدیرِ چندمدرسه‌ای که مدرسه‌یِ دیگری را سوییچ کرده بود
 * درس‌هایِ مدرسه‌یِ *دیگر* را می‌ساخت/می‌دید، و سوپرادمین (بدونِ عضویتِ مدرسه‌ای، schoolId=null) هیچ‌چیز نمی‌دید.
 */
export function useActiveSchoolId(me: { role?: string | null; schoolId?: string | null } | null | undefined): string | undefined {
  const viewed = useViewedSchoolId(me?.schoolId);
  return me?.role === "admin" ? viewed : (me?.schoolId ?? undefined);
}
