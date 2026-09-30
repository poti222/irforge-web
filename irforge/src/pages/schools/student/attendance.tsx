import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ClipboardCheck } from "lucide-react";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { getSchoolMe, listMyAttendance, type AttendanceStatus } from "@/lib/schools-api";

const STATUS_VARIANT: Record<AttendanceStatus, "default" | "destructive" | "outline" | "secondary"> = {
  present: "default",
  absent: "destructive",
  late: "secondary",
  excused: "outline",
};

/**
 * pages/schools/student/attendance.tsx — «حضور و غیابِ من» (فاز ۶، بندِ ۱):
 * تاریخچه‌ی فقط‌خواندنیِ خودِ دانش‌آموز. همین کامپوننت مستقیماً توسطِ داشبوردِ
 * والد (parent/reports.tsx) هم برایِ فرزند بازاستفاده می‌شود — طبقِ اسپکِ فازِ
 * ۶: «یک UI برایِ حضور و غیاب، نه دو تا».
 */
export default function StudentAttendancePage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navAttendance);

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;

  const { data: records, isLoading } = useQuery({
    queryKey: ["schools", "attendance", "my", schoolId],
    queryFn: () => listMyAttendance(schoolId!),
    enabled: !!schoolId,
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navAttendance}</h1>
        <p className="text-sm text-muted-foreground">{t.studentAttendanceDescription}</p>
      </div>
      <AttendanceHistoryList records={records} isLoading={isLoading} />
    </div>
  );
}

export function AttendanceHistoryList({ records, isLoading }: { records: { id: string; date: string; status: AttendanceStatus; note: string | null }[] | undefined; isLoading: boolean }) {
  const t = useT("schools") as any;
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="size-4" /> {t.navAttendance}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-2">
        {isLoading ? (
          <Loader2 className="size-5 animate-spin" />
        ) : !records || records.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.attendanceEmpty}</p>
        ) : (
          records.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
              <span dir="ltr">{new Date(r.date).toLocaleDateString()}</span>
              <div className="flex items-center gap-2">
                {r.note && <span className="text-xs text-muted-foreground">{r.note}</span>}
                <Badge variant={STATUS_VARIANT[r.status]}>{t[`attendanceStatus_${r.status}`]}</Badge>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
