import { useQuery } from "@tanstack/react-query";
import { Redirect } from "wouter";
import { Spinner } from "@/components/ui/spinner";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { getSchoolMe, type SchoolMemberRole } from "@/lib/schools-api";
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

  if (isLoading) {
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

  return <Redirect to={ROLE_HOME[me.role]} />;
}
