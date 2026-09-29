import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, BarChart3, MessagesSquare } from "lucide-react";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { listMyChildren, listCounselorReports, type CounselorReport, type MyChild } from "@/lib/schools-api";
import { AdminChatThread } from "@/components/schools/AdminChatThread";

/**
 * pages/schools/parent/reports.tsx — «گزارش‌ها»/«چت» برایِ والد (فاز ۵،
 * بندِ ۲): تا اینجا والد فقط نمایِ فقط‌خواندنیِ فرزندان (children.tsx) داشت.
 * این صفحه هم گزارش‌هایِ مشاور دربابِ فرزندِ خودِ والد (فقط‌خواندنی، مرزِ
 * حریمِ خصوصی سمتِ سرور با school_guardianships چک می‌شود — ببینید
 * myChildrenMemberIdsInSchool در routes/schoolCounselorReports.ts) و هم
 * رشته‌ی «ارتباط با مدیر»ِ همان فرزند را نشان می‌دهد. تصمیمِ فازِ ۵: به‌جایِ
 * ساختنِ یک سیستمِ پیام‌رسانیِ جداگانه برایِ والد، همان رشته‌ی مشترکِ
 * ارتباط‌با‌مدیر (بندِ ۱) که از اول غیرِمحرمانه/چندنفره طراحی شده بود را
 * والد هم می‌بیند و می‌تواند در آن بنویسد — دو آیتمِ ناوبریِ جداگانه‌ی
 * «گزارش‌ها»/«چت» هر دو به همین یک صفحه می‌روند.
 */
export default function ParentReportsPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navReports);

  const { data: children, isLoading } = useQuery({ queryKey: ["schools", "my-children"], queryFn: listMyChildren });

  const [selectedChildId, setSelectedChildId] = useState<string>("");
  useEffect(() => {
    if (!selectedChildId && children && children.length > 0) {
      setSelectedChildId(children[0].id);
    }
  }, [children, selectedChildId]);

  const selectedChild = (children ?? []).find((c: MyChild) => c.id === selectedChildId);
  const childSchoolId = selectedChild?.school?.id;

  const { data: reports, isLoading: reportsLoading } = useQuery({
    queryKey: ["schools", "counselor-reports", childSchoolId],
    queryFn: () => listCounselorReports(childSchoolId!),
    enabled: !!childSchoolId,
  });
  // سرور خودش فقط گزارش‌های فرزندهای همین والد را برمی‌گرداند؛ اینجا فقط
  // برای همین فرزندِ انتخاب‌شده فیلتر می‌کنیم (والد ممکن است چند فرزند در
  // یک مدرسه داشته باشد).
  const childReports = (reports ?? []).filter((r: CounselorReport) => r.studentMemberId === selectedChildId);

  if (isLoading) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navReports} / {t.navChat}</h1>
        <p className="text-sm text-muted-foreground">{t.parentReportsDescription}</p>
      </div>

      {!children || children.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.noChildrenLinked}</div>
      ) : (
        <>
          {children.length > 1 && (
            <div className="flex flex-col gap-1.5 sm:w-64">
              <Select value={selectedChildId} onValueChange={setSelectedChildId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {children.map((c: MyChild) => (
                    <SelectItem key={c.id} value={c.id}>{c.grade ?? "—"} · {c.school?.name ?? "—"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="size-4" /> {t.navReports}</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2">
              {reportsLoading ? (
                <Loader2 className="size-5 animate-spin" />
              ) : childReports.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.parentReportsEmpty}</p>
              ) : (
                childReports.map((r: CounselorReport) => (
                  <div key={r.id} className="rounded-md border p-3 text-sm">
                    <p className="font-medium">{r.title}</p>
                    <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{r.body}</p>
                    <p className="mt-2 text-xs text-muted-foreground" dir="ltr">{new Date(r.createdAt).toLocaleString()}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {childSchoolId && selectedChildId && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><MessagesSquare className="size-4" /> {t.navChat}</CardTitle></CardHeader>
              <CardContent>
                <AdminChatThread schoolId={childSchoolId} studentMemberId={selectedChildId} />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
