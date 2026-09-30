import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, GraduationCap } from "lucide-react";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { getSchoolMe, getMyGradebook, type GradeItem } from "@/lib/schools-api";

/**
 * pages/schools/student/grades.tsx — «نمره‌های من» (فاز ۶، بندِ ۲): فهرستِ
 * ترکیبیِ نمره‌های تکلیف+آزمونِ خودِ دانش‌آموز + میانگینِ ساده. همین کامپوننت
 * مستقیماً توسطِ داشبوردِ والد بازاستفاده می‌شود (getChildGradebook همان
 * queryِ سمتِ سرور را با چکِ guardianship اجرا می‌کند).
 */
export default function StudentGradesPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navGrades);

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;

  const { data, isLoading } = useQuery({
    queryKey: ["schools", "gradebook", "my", schoolId],
    queryFn: () => getMyGradebook(schoolId!),
    enabled: !!schoolId,
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navGrades}</h1>
        <p className="text-sm text-muted-foreground">{t.studentGradesDescription}</p>
      </div>
      <GradesList items={data?.items} average={data?.average ?? null} isLoading={isLoading} />
    </div>
  );
}

export function GradesList({ items, average, isLoading }: { items: GradeItem[] | undefined; average: number | null; isLoading: boolean }) {
  const t = useT("schools") as any;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><GraduationCap className="size-4" /> {t.navGrades}</CardTitle>
        {average !== null && (
          <Badge className="text-sm" dir="ltr">{t.gradebookAverageColumn}: {average.toFixed(1)}</Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {isLoading ? (
          <Loader2 className="size-5 animate-spin" />
        ) : !items || items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.gradebookNoItems}</p>
        ) : (
          items.map((item) => (
            <div key={`${item.itemType}-${item.itemId}`} className="flex items-center justify-between rounded-md border p-2 text-sm">
              <div className="flex flex-col">
                <span className="font-medium">{item.itemTitle}</span>
                <span className="text-xs text-muted-foreground">{item.itemType === "assignment" ? t.gradebookKindAssignment : t.gradebookKindExam}</span>
              </div>
              <Badge variant="outline" dir="ltr">{item.value ?? "—"}</Badge>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
