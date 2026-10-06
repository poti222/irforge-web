import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { SchoolSidebar } from "@/components/schools/school-sidebar";
import { InviteCodeWidget } from "@/components/schools/InviteCodeWidget";
import { BotConnectWidget } from "@/components/schools/BotConnectWidget";
import { HeaderControls } from "@/components/layout/header-controls";
import ErrorBoundary from "@/components/error-boundary";
import { Spinner } from "@/components/ui/spinner";
import { getSchoolMe, listMySchools } from "@/lib/schools-api";
import { Link, Redirect } from "wouter";
import { ShieldCheck } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { ViewedSchoolProvider, useViewedSchool, useViewedSchoolId } from "@/hooks/use-viewed-school";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

/**
 * `/super`: نوارِ «حالتِ سوپرادمین» — مدرسه‌یِ در حالِ مدیریت (با سوییچرِ همه‌یِ مدارس) + بازگشت به /super. فقط وقتی می‌آید
 * که `me.isSuperAdmin`. اگر هنوز مدرسه‌ای انتخاب نشده (یا انتخابِ قبلی دیگر وجود ندارد) اولین مدرسه انتخاب می‌شود تا
 * صفحاتِ مدیریتی خالی نمانند. داخلِ ViewedSchoolProvider است.
 */
function SuperModeBanner() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { viewedSchoolId, setViewedSchoolId } = useViewedSchool();
  const { data: schools } = useQuery({ queryKey: ["schools", "my-schools"], queryFn: listMySchools });
  const list = schools ?? [];
  const current = list.find((s) => s.id === viewedSchoolId);

  useEffect(() => {
    if (list.length > 0 && !current) setViewedSchoolId(list[0].id);
  }, [list.length, current, setViewedSchoolId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-primary/10 px-4 py-2 text-sm" data-testid="super-mode-banner">
      <ShieldCheck className="size-4 shrink-0 text-primary" />
      <span className="shrink-0">{fa ? "حالتِ سوپرادمین — مدیریتِ" : "Super-admin mode — managing"}</span>
      {list.length > 0 ? (
        <Select value={current?.id ?? ""} onValueChange={setViewedSchoolId}>
          <SelectTrigger className="h-8 w-56 bg-background" data-testid="super-mode-school-select"><SelectValue /></SelectTrigger>
          <SelectContent>
            {list.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : (
        <span className="text-muted-foreground">{fa ? "هنوز مدرسه‌ای نیست — از /super بسازید" : "no schools yet — create one in /super"}</span>
      )}
      <Link href="/super?tab=schools" className="ms-auto font-medium text-primary hover:underline">
        {fa ? "بازگشت به پنل سوپرادمین" : "Back to the super-admin panel"}
      </Link>
    </div>
  );
}

export default function SchoolShell({ children }: { children: ReactNode }) {
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
          {me.isSuperAdmin && <SuperModeBanner />}
          <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger />
            <HeaderControls />
          </header>
          <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
            <div className="mx-auto flex max-w-6xl flex-col gap-4 lg:flex-row lg:items-start">
              <div className="min-w-0 flex-1">
                <ErrorBoundary inline>{children}</ErrorBoundary>
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
                {!me.school && !me.isSuperAdmin && <InviteCodeWidget compact />}
              </div>
            </div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </ViewedSchoolProvider>
  );
}
