import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { MessageCircleQuestion, ShieldCheck, GraduationCap, ClipboardList, FileQuestion, ClipboardCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { getSchoolMe, listMyAlerts } from "@/lib/schools-api";
import { AlertsFeed } from "@/pages/schools/admin/alerts";
import { GuardianRequestsCard } from "@/components/schools/GuardianRequestsCard";
import { TimetableNowCard } from "@/components/schools/TimetableView";
import { SubjectsHub } from "@/pages/schools/content-subjects";

/**
 * خانه‌یِ دانش‌آموز = فهرستِ «درس‌ها» (موضوعاتِ مدرسه)، طبقِ خواسته‌یِ کاربر؛
 * پنج تایلِ جدایِ محتوا (لغت‌نامه/اشعار/...) حذف شدند — آن‌ها حالا داخلِ هر
 * درس (سطحِ جلسه) و فقط در صورتِ فعال‌بودن دیده می‌شوند. میان‌برهایِ غیرمحتوایی
 * (تکالیف/آزمون/حضور/نمره/ارتباط) فشرده، *زیرِ* موضوعات می‌مانند.
 */
const TILES = [
  // فاز ۳ (بندِ ۳): «تکالیفِ من» — تکِ تایلِ تازه، به‌جایِ یک نوارِ کناریِ
  // مجزا، چون این تایلیِ سادۀ صفحه‌ی خانه‌ی دانش‌آموز الگویِ بقیه هم هست.
  { key: "assignments", href: "/schools/student/assignments", icon: ClipboardList },
  // فاز ۴ (بندِ ۲/۱): «آزمونِ من» و «ارتباط با مشاور» دیگر استاب نیستند.
  { key: "exams", href: "/schools/student/exams", icon: FileQuestion },
  // فاز ۶ (بندِ ۱/۲): «حضور و غیاب» و «نمره‌های من» دیگر استاب نیستند.
  { key: "attendance", href: "/schools/student/attendance", icon: ClipboardCheck },
  { key: "grades", href: "/schools/student/grades", icon: GraduationCap },
  { key: "contact-counselor", href: "/schools/student/counselor", icon: MessageCircleQuestion },
  { key: "contact-admin", href: "/schools/student/admin-chat", icon: ShieldCheck },
  { key: "contact-teacher", href: "/schools/student/teacher-chat", icon: GraduationCap },
];

const TILE_LABEL_KEY: Record<string, string> = {
  assignments: "navAssignments",
  exams: "navExams",
  attendance: "navAttendance",
  grades: "navGrades",
  "contact-counselor": "navContactCounselor",
  "contact-admin": "navContactAdmin",
  "contact-teacher": "navContactTeacher",
};

export default function SchoolsStudentHome() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.studentHomeTitle);
  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;
  // فاز ۶ (بندِ ۴): اخطار/هشدار باید در داشبوردِ خودِ دانش‌آموز هم دیده شود،
  // نه فقط برایِ والد — طبقِ اسپکِ صریحِ فاز.
  const { data: alerts, isLoading: alertsLoading } = useQuery({
    queryKey: ["schools", "alerts", "my", schoolId],
    queryFn: () => listMyAlerts(schoolId!),
    enabled: !!schoolId,
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{me?.school?.name ?? t.studentHomeTitle}</h1>
        <p className="text-sm text-muted-foreground">{t.studentHomeDescription}</p>
      </div>
      {alerts && alerts.length > 0 && <AlertsFeed alerts={alerts} isLoading={alertsLoading} />}
      <GuardianRequestsCard schoolId={schoolId} />
      <TimetableNowCard schoolId={schoolId} />
      <SubjectsHub embedded />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {TILES.map((tile) => (
          <Link key={tile.key} href={tile.href}>
            <Card className="cursor-pointer transition hover:border-primary/50">
              <CardContent className="flex min-h-14 items-center gap-2.5 p-3">
                <tile.icon className="size-5 shrink-0 text-primary" />
                <span className="text-sm font-medium">{t[TILE_LABEL_KEY[tile.key]]}</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
