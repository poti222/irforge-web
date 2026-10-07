import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CalendarDays, Megaphone } from "lucide-react";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { TimetableNowCard } from "@/components/schools/TimetableView";
import { getSchoolMe, listSchoolClasses, listSchoolAnnouncements } from "@/lib/schools-api";

/**
 * pages/schools/teacher/today.tsx — «امروز» (فاز ۳، بندِ ۳): یک داشبوردِ
 * سادۀ فقط‌خواندنی که برایِ هر کلاسِ معلم، آخرین اطلاعیه‌های همان کلاس
 * (kind="class" رویِ همان جدولِ اعلامیه‌هایِ فازِ ۲) را نشان می‌دهد — بدونِ
 * بک‌اندِ تازه، صرفاً ترکیبِ دو endpointِ موجود.
 */
export default function TeacherTodayPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navToday);

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;

  const { data: myClasses, isLoading } = useQuery({
    queryKey: ["schools", "classes", schoolId, "mine"],
    queryFn: () => listSchoolClasses(schoolId!, true),
    enabled: !!schoolId,
  });

  if (isLoading) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navToday}</h1>
        <p className="text-sm text-muted-foreground">{t.teacherTodayDescription}</p>
      </div>
      <TimetableNowCard schoolId={schoolId} />
      {!myClasses || myClasses.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.classesEmpty}</div>
      ) : (
        <div className="flex flex-col gap-4">
          {myClasses.map((c) => (
            <ClassFeedCard key={c.id} schoolId={schoolId!} classId={c.id} className={c.name} />
          ))}
        </div>
      )}
    </div>
  );
}

function ClassFeedCard({ schoolId, classId, className }: { schoolId: string; classId: string; className: string }) {
  const t = useT("schools") as any;
  const { data: items } = useQuery({
    queryKey: ["schools", "announcements", schoolId, classId],
    queryFn: () => listSchoolAnnouncements(schoolId, classId),
  });
  const classItems = (items ?? []).filter((a) => a.kind === "class").slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="size-4" /> {className}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {classItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.teacherTodayEmpty}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {classItems.map((a) => (
              <div key={a.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                <Megaphone className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <div className="font-medium">{a.title}</div>
                  {a.body && <p className="text-muted-foreground">{a.body}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
