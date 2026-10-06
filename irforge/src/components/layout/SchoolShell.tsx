import type { ReactNode } from "react";
import { EnamadSeal } from "@/components/layout/enamad-seal";
import { useQuery } from "@tanstack/react-query";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { SchoolSidebar } from "@/components/schools/school-sidebar";
import { InviteCodeWidget } from "@/components/schools/InviteCodeWidget";
import { BotConnectWidget } from "@/components/schools/BotConnectWidget";
import { HeaderControls } from "@/components/layout/header-controls";
import ErrorBoundary from "@/components/error-boundary";
import { Spinner } from "@/components/ui/spinner";
import { getSchoolMe } from "@/lib/schools-api";
import { Redirect, useLocation } from "wouter";
import { ViewedSchoolProvider, useViewedSchoolId } from "@/hooks/use-viewed-school";
import { TestModeBanner } from "@/components/layout/TestModeBanner";

/**
 * SchoolShell.tsx — معادلِ DashboardShell برایِ بخشِ "/schools"، اما با
 * سایدبارِ نقش‌محور (SchoolSidebar) به‌جایِ AppSidebar، و ویجتِ کدِ معرف کنارِ
 * سایدبار (طبقِ خواستِ کاربر: «توی یک بخش جدا کنار سایدبار»، جدا از همان
 * فیلد داخلِ فرمِ اولیه).
 *
 * این شل فرض می‌کند پروفایلِ مدرسه‌ای کامل است — SchoolsEntry
 * (pages/schools/index.tsx) قبل از رسیدن به این‌جا آن‌را چک کرده. اگر به هر
 * دلیل (مثلاً بازکردنِ مستقیمِ لینکِ یک زیرصفحه) کامل نبود، دوباره کاربر را
 * به /schools برمی‌گرداند تا آنجا آنبوردینگ انجام شود.
 */
/**
 * فازِ ۹ (بندِ ۴، از گزارشِ فازِ ۷): BotConnectWidget قبلاً فقط مدرسه‌ی اصلیِ
 * عضویتِ کاربر (`me.school.id`) را می‌دید — مدیرِ چندمدرسه‌ای که از سوییچرِ
 * «مدرسه‌های من» یک مدرسه‌ی دیگر را نگاه می‌کرد، ویجتِ اتصال را برایِ همان
 * مدرسه‌ی *دیده‌شده* نمی‌دید. useViewedSchoolId باید داخلِ خودِ
 * ViewedSchoolProvider فراخوانی شود (زیرمجموعه‌ی آن در درختِ رندر)، پس یک
 * کامپوننتِ کوچکِ جدا لازم است — خودِ SchoolShell که Provider را می‌سازد
 * نمی‌تواند مستقیماً useViewedSchoolId را صدا بزند.
 */
function ScopedBotConnectWidget({ fallbackSchoolId }: { fallbackSchoolId?: string | null }) {
  const schoolId = useViewedSchoolId(fallbackSchoolId);
  if (!schoolId) return null;
  return <BotConnectWidget schoolId={schoolId} />;
}

export default function SchoolShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { data: me, isLoading } = useQuery({
    queryKey: ["schools", "me"],
    queryFn: getSchoolMe,
  });

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!me || !me.profileComplete) {
    return <Redirect to="/schools" />;
  }

  return (
    <ViewedSchoolProvider>
      <SidebarProvider>
        <SchoolSidebar role={me.role} schoolName={me.school?.name} />
        <SidebarInset>
          <TestModeBanner />
          <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger />
            <HeaderControls />
          </header>
          <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
            <div className="mx-auto flex max-w-6xl flex-col gap-4 lg:flex-row lg:items-start">
              <div className="min-w-0 flex-1">
                <ErrorBoundary inline resetKey={location}>{children}</ErrorBoundary>
              </div>
              {/* ویجتِ مستقلِ «پیدا کردن/پیوستن به مدرسه» کنارِ سایدبار — روی
                  موبایل زیرِ محتوا می‌افتد، روی دسکتاپ یک ستونِ کناری باریک. */}
              <div className="flex w-full shrink-0 flex-col gap-4 lg:w-72">
                <ScopedBotConnectWidget fallbackSchoolId={me.school?.id} />
                {/* طبقِ خواستِ کاربر: کسی که از قبل عضوِ مدرسه‌ای است (me.school
                    موجود است) این ویجتِ همیشه‌نمایان را نمی‌بیند — فقط کسی که
                    هنوز هیچ مدرسه‌ای ندارد (مثلاً نقش را انتخاب کرده ولی هنوز
                    کدِ معرف نداده) آن‌را این‌جا پرزنت می‌بیند؛ بقیه از آیتمِ
                    ناوبریِ «پیدا کردن مدرسه‌ی دیگر» در سایدبار استفاده می‌کنند
                    (school-sidebar.tsx). */}
                {!me.school && <InviteCodeWidget compact />}
              </div>
            </div>
          </main>
          <EnamadSeal className="border-t py-3" />
        </SidebarInset>
      </SidebarProvider>
    </ViewedSchoolProvider>
  );
}
