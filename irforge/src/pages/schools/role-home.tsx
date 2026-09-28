import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";

/**
 * pages/schools/role-home.tsx — صفحه‌ی خانه‌ی نقش‌هایی که فاز ۱ فقط
 * اسکلتِ ناوبری برایشان می‌سازد (معلم/مشاور/معاون/معاون‌انضباطی/والد). هر
 * آیتم به یک صفحه‌ی «به‌زودی» می‌رود — CRUDِ واقعی فازِ بعدی است.
 */
const ROLE_ITEMS: Record<string, { key: string; labelKey: string }[]> = {
  teacher: [
    { key: "assignments", labelKey: "navAssignments" },
    { key: "exams", labelKey: "navExams" },
    { key: "question-bank", labelKey: "navQuestionBank" },
    { key: "classrooms", labelKey: "navClassrooms" },
    { key: "today", labelKey: "navToday" },
  ],
  counselor: [
    { key: "student-list", labelKey: "navStudentList" },
    { key: "reports", labelKey: "navReports" },
    { key: "chat", labelKey: "navChat" },
    { key: "schedule", labelKey: "navSchedule" },
  ],
  deputy: [
    { key: "members", labelKey: "navMemberManagement" },
    { key: "programs", labelKey: "navProgramManagement" },
    { key: "broadcast", labelKey: "navBroadcast" },
    { key: "closure", labelKey: "navClosureAnnouncement" },
  ],
  "deputy-discipline": [
    { key: "members", labelKey: "navMemberManagement" },
    { key: "programs", labelKey: "navProgramManagement" },
    { key: "broadcast", labelKey: "navBroadcast" },
    { key: "closure", labelKey: "navClosureAnnouncement" },
  ],
  parent: [
    { key: "children", labelKey: "navChildrenOverview" },
    { key: "reports", labelKey: "navReports" },
    { key: "chat", labelKey: "navChat" },
  ],
};

const ROLE_TITLE_KEY: Record<string, string> = {
  teacher: "roleTeacher",
  counselor: "roleCounselor",
  deputy: "roleDeputy",
  "deputy-discipline": "roleDeputyDiscipline",
  parent: "roleParent",
};

export default function SchoolsRoleHome({ role }: { role: string }) {
  const t = useT("schools") as any;
  const title = t[ROLE_TITLE_KEY[role] ?? "roleTeacher"];
  usePrivatePageTitle(title);
  const items = ROLE_ITEMS[role] ?? [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">{title}</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <Link key={item.key} href={`/schools/stub/${item.key}`}>
            <Card className="cursor-pointer transition hover:border-primary/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t[item.labelKey]}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">{t.comingSoon}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
