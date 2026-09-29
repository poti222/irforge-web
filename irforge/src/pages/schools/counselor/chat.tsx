import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, MessagesSquare } from "lucide-react";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { getSchoolMe, listCounselorStudents } from "@/lib/schools-api";
import { CounselorChatThread } from "@/components/schools/CounselorChatThread";

/**
 * pages/schools/counselor/chat.tsx — «چت» (فاز ۴، بندِ ۱): مشاور از رویِ
 * لیستِ دانش‌آموزانِ مدرسه (همان لیستِ counselor/students.tsx) یکی را انتخاب
 * می‌کند و رشته‌ی گفتگو با او باز می‌شود.
 */
export default function CounselorChatPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navChat);

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;

  const { data: students, isLoading } = useQuery({
    queryKey: ["schools", "counselor-students", schoolId],
    queryFn: () => listCounselorStudents(schoolId!),
    enabled: !!schoolId,
  });

  const [selected, setSelected] = useState<string | null>(null);

  if (isLoading) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navChat}</h1>
        <p className="text-sm text-muted-foreground">{t.counselorChatDescription}</p>
      </div>

      {!students || students.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.membersEmpty}</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><MessagesSquare className="size-4" /> {t.navStudentList}</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-1">
              {students.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-start text-sm transition ${selected === s.id ? "bg-primary/10 font-medium" : "hover:bg-muted"}`}
                >
                  {s.unread && <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden />}
                  {s.grade ?? "—"} · {s.userId}
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{t.navChat}</CardTitle></CardHeader>
            <CardContent>
              {!selected ? (
                <p className="text-sm text-muted-foreground">{t.selectStudentHint}</p>
              ) : (
                <CounselorChatThread schoolId={schoolId!} counselorUserId={me!.userId} studentMemberId={selected} />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
