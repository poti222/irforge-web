import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarClock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { getMyTimetable, type TimetableSlot } from "@/lib/schools-api";
import { displayTime, iranianDayIndex, nowAndNext } from "@/lib/timetable";

/** هر دقیقه ساعتِ جاری را تازه می‌کند تا «الان/بعدی» خودکار جابه‌جا شود. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(id); }, []);
  return now;
}

function SlotLine({ s, fa, showClass, active }: { s: TimetableSlot; fa: boolean; showClass?: boolean; active?: boolean }) {
  const t = useT("schools") as any;
  return (
    <div className={`flex items-center gap-3 rounded-md px-2 py-1.5 ${active ? "bg-primary/10 ring-1 ring-primary" : ""}`}>
      <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground" dir="ltr">{displayTime(s.startTime, fa)}–{displayTime(s.endTime, fa)}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{s.subject}{active && <Badge className="ms-2 px-1.5 py-0 text-[10px]">{t.ttNow}</Badge>}</div>
        <div className="truncate text-xs text-muted-foreground">
          {[showClass ? s.className : null, s.teacherName, s.note].filter(Boolean).join(" · ")}
        </div>
      </div>
      {s.mine && <Badge variant="secondary" className="shrink-0 text-[10px]">{t.ttMineBadge}</Badge>}
    </div>
  );
}

/** هفته‌یِ کامل: روزِ امروز بالا برجسته می‌شود؛ روزهایِ خالی نمایش داده نمی‌شوند. */
export function TimetableWeek({ slots, showClass }: { slots: TimetableSlot[]; showClass?: boolean }) {
  const t = useT("schools") as any;
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const now = useNow();
  const today = iranianDayIndex(now);
  const { current } = nowAndNext(slots, now);
  const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => slots.some((s) => s.dayOfWeek === d));
  if (!days.length) return <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.ttEmptyMine}</div>;
  return (
    <div className="flex flex-col gap-3">
      {days.map((d) => (
        <Card key={d} className={d === today ? "border-primary" : undefined} data-testid={`tt-view-day-${d}`}>
          <CardContent className="flex flex-col gap-1 p-3">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
              {t[`ttDay${d}`]}
              {d === today && <Badge variant="outline" className="text-[10px]">{t.ttToday}</Badge>}
            </div>
            {slots.filter((s) => s.dayOfWeek === d).sort((a, b) => a.startTime.localeCompare(b.startTime)).map((s) => (
              <SlotLine key={s.id} s={s} fa={fa} showClass={showClass} active={current?.id === s.id} />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** تایلِ فشرده‌یِ «زنگِ الان / بعدی» برایِ خانه‌یِ دانش‌آموز/معلم؛ بدونِ برنامه چیزی نمایش نمی‌دهد. */
export function TimetableNowCard({ schoolId }: { schoolId: string | undefined }) {
  const t = useT("schools") as any;
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const now = useNow();
  const { data } = useQuery({ queryKey: ["schools", "timetable", "mine", schoolId], queryFn: () => getMyTimetable(schoolId!), enabled: !!schoolId });
  if (!data || data.slots.length === 0) return null;
  const { current, next } = nowAndNext(data.slots, now);
  return (
    <Link href="/schools/timetable">
      <Card className="cursor-pointer transition hover:border-primary/50" data-testid="tt-now-card">
        <CardContent className="flex items-center gap-3 p-3">
          <CalendarClock className="size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1 text-sm">
            <div className="truncate font-medium">
              {current ? <>{t.ttNow}: {current.subject} <span className="text-xs text-muted-foreground" dir="ltr">({displayTime(current.startTime, fa)}–{displayTime(current.endTime, fa)})</span></> : t.ttNothingNow}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {next ? <>{t.ttNext}: {next.subject} <span dir="ltr">({displayTime(next.startTime, fa)})</span></> : t.ttNoMore}
            </div>
          </div>
          <span className="shrink-0 text-xs text-primary">{t.ttOpen}</span>
        </CardContent>
      </Card>
    </Link>
  );
}
