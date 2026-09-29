import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ClipboardCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import {
  getSchoolMe, listSchoolClasses, listClassMembers, listSchoolMembers,
  listClassAttendance, markAttendance, ATTENDANCE_STATUSES, type AttendanceStatus,
} from "@/lib/schools-api";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * pages/schools/teacher/attendance.tsx — «حضور و غیاب» (فاز ۶، بندِ ۱): معلم
 * یکی از کلاس‌های خودش و یک تاریخ را انتخاب می‌کند، وضعیتِ هر دانش‌آموزِ
 * روستر را می‌زند و یک‌جا (POST دسته‌جمعی) ذخیره می‌کند. نشانه‌گذاریِ دوباره‌ی
 * همان روز فقط ردیفِ موجود را ویرایش می‌کند (سرور upsert می‌کند).
 */
export default function TeacherAttendancePage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navAttendance);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;

  const { data: myClasses, isLoading } = useQuery({
    queryKey: ["schools", "classes", schoolId, "mine"],
    queryFn: () => listSchoolClasses(schoolId!, true),
    enabled: !!schoolId,
  });

  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [date, setDate] = useState<string>(todayIso());
  const [saving, setSaving] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>({});

  const { data: roster } = useQuery({
    queryKey: ["schools", "class-members", selectedClassId],
    queryFn: () => listClassMembers(schoolId!, selectedClassId),
    enabled: !!schoolId && !!selectedClassId,
  });
  const { data: members } = useQuery({ queryKey: ["schools", "members", schoolId], queryFn: () => listSchoolMembers(schoolId!), enabled: !!schoolId });
  const { data: existing } = useQuery({
    queryKey: ["schools", "attendance", selectedClassId, date],
    queryFn: () => listClassAttendance(schoolId!, selectedClassId, { date }),
    enabled: !!schoolId && !!selectedClassId && !!date,
  });

  const students = (roster ?? []).filter((r) => r.roleInClass === "student");

  function statusFor(studentMemberId: string): AttendanceStatus {
    if (statuses[studentMemberId]) return statuses[studentMemberId];
    const row = (existing ?? []).find((e) => e.studentMemberId === studentMemberId);
    return row?.status ?? "present";
  }

  async function handleSave() {
    if (!schoolId || !selectedClassId || students.length === 0) return;
    setSaving(true);
    try {
      await markAttendance(schoolId, {
        classId: selectedClassId,
        date,
        entries: students.map((s) => ({ studentMemberId: s.schoolMemberId, status: statusFor(s.schoolMemberId) })),
      });
      await queryClient.invalidateQueries({ queryKey: ["schools", "attendance", selectedClassId, date] });
      setStatuses({});
      toast({ title: t.attendanceSaved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.attendanceSaveError, description: err?.data?.error });
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navAttendance}</h1>
        <p className="text-sm text-muted-foreground">{t.attendancePageDescription}</p>
      </div>

      {!myClasses || myClasses.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.classesEmpty}</div>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-1.5 sm:w-64">
              <Label>{t.fieldClass}</Label>
              <Select value={selectedClassId} onValueChange={setSelectedClassId}>
                <SelectTrigger><SelectValue placeholder={t.selectClassPlaceholder} /></SelectTrigger>
                <SelectContent>
                  {myClasses.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5 sm:w-52">
              <Label>{t.fieldAttendanceDate}</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" />
            </div>
          </div>

          {selectedClassId && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="size-4" /> {t.rosterTitle}</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-2">
                {students.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t.rosterEmpty}</p>
                ) : (
                  students.map((s) => {
                    const person = (members ?? []).find((m) => m.id === s.schoolMemberId);
                    const status = statusFor(s.schoolMemberId);
                    return (
                      <div key={s.id} className="flex flex-col gap-2 rounded-md border p-2 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-sm font-medium">{person?.userName ?? person?.userEmail ?? s.schoolMemberId}</span>
                        <Select value={status} onValueChange={(v) => setStatuses((st) => ({ ...st, [s.schoolMemberId]: v as AttendanceStatus }))}>
                          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ATTENDANCE_STATUSES.map((st) => (
                              <SelectItem key={st} value={st}>{t[`attendanceStatus_${st}`]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })
                )}
                {students.length > 0 && (
                  <Button onClick={handleSave} disabled={saving} className="w-fit">
                    {saving && <Loader2 className="me-2 size-4 animate-spin" />}
                    {t.saveButton}
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
