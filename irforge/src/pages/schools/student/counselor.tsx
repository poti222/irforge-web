import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, CalendarClock, MessageCircleQuestion } from "lucide-react";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { getSchoolMe, listSchoolCounselors, listCounselorSchedule } from "@/lib/schools-api";
import { CounselorChatThread } from "@/components/schools/CounselorChatThread";

const DAYS_FA = ["شنبه", "یک‌شنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه"];

/**
 * pages/schools/student/counselor.tsx — «ارتباط با مشاور» (فاز ۴، بندِ ۱):
 * قبلاً فقط یک استابِ خالی بود (`/schools/stub/contact-counselor`)؛ حالا
 * برنامه‌ی هفتگیِ مشاور (فقط‌خواندنی) + چتِ یک‌به‌یک. اگر مدرسه هیچ مشاوری
 * نداشته باشد، یک حالتِ خالیِ ساده نشان می‌دهد نه کرش.
 */
export default function StudentCounselorPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navContactCounselor);

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;

  const { data: counselors, isLoading } = useQuery({
    queryKey: ["schools", "counselor-list", schoolId],
    queryFn: () => listSchoolCounselors(schoolId!),
    enabled: !!schoolId,
  });

  const [selectedCounselor, setSelectedCounselor] = useState<string>("");
  useEffect(() => {
    if (!selectedCounselor && counselors && counselors.length > 0) {
      setSelectedCounselor(counselors[0].userId);
    }
  }, [counselors, selectedCounselor]);

  const { data: schedule } = useQuery({
    queryKey: ["schools", "counselor-schedule", schoolId, selectedCounselor],
    queryFn: () => listCounselorSchedule(schoolId!, selectedCounselor),
    enabled: !!schoolId && !!selectedCounselor,
  });

  if (isLoading) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navContactCounselor}</h1>
        <p className="text-sm text-muted-foreground">{t.studentCounselorDescription}</p>
      </div>

      {!counselors || counselors.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground">
          <MessageCircleQuestion className="size-6" />
          {t.noCounselorYet}
        </div>
      ) : (
        <>
          {counselors.length > 1 && (
            <div className="flex flex-col gap-1.5 sm:w-64">
              <Select value={selectedCounselor} onValueChange={setSelectedCounselor}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {counselors.map((c) => <SelectItem key={c.userId} value={c.userId}>{c.userId}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="size-4" /> {t.navSchedule}</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2">
              {!schedule || schedule.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.scheduleEmpty}</p>
              ) : (
                schedule.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-sm">
                    <Badge variant="outline">{DAYS_FA[Number(s.dayOfWeek)] ?? s.dayOfWeek}</Badge>
                    <span dir="ltr">{s.startTime}–{s.endTime}</span>
                    {s.description && <span className="text-muted-foreground">· {s.description}</span>}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {selectedCounselor && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">{t.navChat}</CardTitle></CardHeader>
              <CardContent>
                <CounselorChatThread schoolId={schoolId!} counselorUserId={selectedCounselor} studentMemberId={me!.id} />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
