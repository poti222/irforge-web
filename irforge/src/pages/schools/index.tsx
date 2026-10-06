import { useQuery } from "@tanstack/react-query";
import { Redirect } from "wouter";
import { Spinner } from "@/components/ui/spinner";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { getSchoolMe, getEnrollmentStatus, type SchoolMemberRole } from "@/lib/schools-api";
import SchoolsOnboarding from "@/pages/schools/onboarding";

/**
 * pages/schools/index.tsx — نقطه‌ی ورودِ بخشِ "/schools".
 *
 * اگر پروفایلِ مدرسه‌ای وجود نداشته باشد یا ناقص باشد، فرمِ آنبوردینگ نمایش
 * داده می‌شود (بدونِ SchoolShell — هنوز نقشی معلوم نیست که سایدبار بسازد).
 * اگر کامل باشد، بر اساسِ نقش به زیرمسیرِ همان نقش ریدایرکت می‌شود.
 */
const ROLE_HOME: Record<SchoolMemberRole, string> = {
  admin: "/schools/admin",
  student: "/schools/student",
  teacher: "/schools/teacher",
  counselor: "/schools/counselor",
  deputy: "/schools/deputy",
  deputy_discipline: "/schools/deputy-discipline",
  parent: "/schools/parent",
};

export default function SchoolsEntry() {
  const t = useT("schools");
  usePrivatePageTitle(t.pageTitle);
  const { data: me, isLoading, refetch } = useQuery({
    queryKey: ["schools", "me"],
    queryFn: getSchoolMe,
  });

  // دروازه‌یِ انتخابِ کلاس: دانش‌آموز/معلمِ عضوِ یک مدرسه که هنوز کلاس ندارد قبل از داشبورد به انتخابگر می‌رود.
  // (هویت‌هایِ آزمایشیِ /super سمتِ سرور خودکار کلاس می‌گیرند، پس هرگز اینجا نمی‌ایستند.) شکستِ این query ورود را
  // نمی‌بندد — فقط بدونِ دروازه ادامه می‌دهد؛ پروفایل/خروج هم از SchoolShell همیشه در دسترس‌اند.
  const needsGate = !!me && me.profileComplete && !!me.schoolId && (me.role === "student" || me.role === "teacher");
  const { data: enrollment, isLoading: enrollmentLoading } = useQuery({
    queryKey: ["schools", "enrollment", me?.schoolId],
    queryFn: () => getEnrollmentStatus(me!.schoolId!),
    enabled: needsGate,
    retry: false,
  });

  if (isLoading || (needsGate && enrollmentLoading)) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!me || !me.profileComplete || !me.role) {
    return (
      <SchoolsOnboarding
        onDone={() => {
          refetch();
        }}
      />
    );
  }

  if (enrollment?.needsSelection) return <Redirect to="/schools/class-selection" />;

  return <Redirect to={ROLE_HOME[me.role]} />;
}
