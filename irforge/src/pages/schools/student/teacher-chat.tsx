import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, GraduationCap } from "lucide-react";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { getSchoolMe, listMyTeachers } from "@/lib/schools-api";
import { TeacherChatThread } from "@/components/schools/TeacherChatThread";

/**
 * pages/schools/student/teacher-chat.tsx — «ارتباط با معلم» (فاز ۵، بندِ ۱):
 * قبلاً استابِ `/schools/stub/contact-teacher` بود. دانش‌آموز فقط از میانِ
 * معلم‌هایِ واقعیِ کلاس‌هایِ خودش (لیستِ my-teachers، مبتنی بر روسترِ
 * school_class_members) یکی را انتخاب می‌کند.
 */
export default function StudentTeacherChatPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navContactTeacher);

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;

  const { data: teachers, isLoading } = useQuery({
    queryKey: ["schools", "my-teachers", schoolId],
    queryFn: () => listMyTeachers(schoolId!),
    enabled: !!schoolId,
  });

  const [selected, setSelected] = useState<string | null>(null);

  if (isLoading) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navContactTeacher}</h1>
        <p className="text-sm text-muted-foreground">{t.studentTeacherChatDescription}</p>
      </div>

      {!teachers || teachers.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground">
          <GraduationCap className="size-6" />
          {t.noTeacherYet}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{t.navContactTeacher}</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-1">
              {teachers.map((tch) => (
                <button
                  key={tch.teacherUserId}
                  onClick={() => setSelected(tch.teacherUserId)}
                  className={`rounded-md px-3 py-2 text-start text-sm transition ${selected === tch.teacherUserId ? "bg-primary/10 font-medium" : "hover:bg-muted"}`}
                >
                  {tch.userName ?? tch.userEmail ?? tch.teacherUserId}
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{t.navChat}</CardTitle></CardHeader>
            <CardContent>
              {!selected ? (
                <p className="text-sm text-muted-foreground">{t.selectTeacherHint}</p>
              ) : (
                <TeacherChatThread schoolId={schoolId!} teacherUserId={selected} studentMemberId={me!.id} />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
