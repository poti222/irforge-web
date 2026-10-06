import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getSchoolMe, getMyTimetable } from "@/lib/schools-api";
import { TimetableNowCard, TimetableWeek } from "@/components/schools/TimetableView";

/**
 * pages/schools/timetable.tsx — «برنامه‌یِ من»: دانش‌آموز = هفته‌یِ کلاسِ خودش، معلم = زنگ‌هایِ خودش و کلاس‌هایش،
 * والد = هفته‌یِ کلاسِ فرزندِ پیوندخورده (برایِ هر فرزند). سرور بر اساسِ نقش فیلتر می‌کند (GET /timetable/mine).
 */
export default function SchoolTimetablePage() {
  const t = useT("schools") as any;
  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;
  const role = me?.role;
  const title = role === "teacher" ? t.ttTeacherTitle : role === "parent" ? t.ttParentTitle : t.ttMyTitle;
  usePrivatePageTitle(title);
  const { data, isLoading } = useQuery({ queryKey: ["schools", "timetable", "mine", schoolId], queryFn: () => getMyTimetable(schoolId!), enabled: !!schoolId });
  const [child, setChild] = useState("");
  useEffect(() => { if (!child && data?.children?.length) setChild(data.children[0].childMemberId); }, [data, child]);

  const kids = data?.children ?? [];
  const slots = role === "parent" ? (kids.find((k) => k.childMemberId === child)?.slots ?? []) : (data?.slots ?? []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="text-sm text-muted-foreground">{t.ttMyDescription}</p>
      </div>
      {role === "parent" && kids.length > 1 && (
        <Select value={child} onValueChange={setChild}>
          <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{kids.map((k) => <SelectItem key={k.childMemberId} value={k.childMemberId}>{k.childName}</SelectItem>)}</SelectContent>
        </Select>
      )}
      {isLoading ? <Loader2 className="size-5 animate-spin" /> : (
        <>
          {role !== "parent" && <TimetableNowCard schoolId={schoolId} />}
          <TimetableWeek slots={slots} showClass={role === "teacher" || role === "parent"} />
        </>
      )}
    </div>
  );
}
