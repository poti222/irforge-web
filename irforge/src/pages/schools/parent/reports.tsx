import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, BarChart3, MessagesSquare, ShieldAlert, ClipboardCheck, GraduationCap } from "lucide-react";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import {
  listMyChildren, listCounselorReports, listChildAlerts, listChildAttendance, getChildGradebook,
  type CounselorReport, type MyChild,
} from "@/lib/schools-api";
import { AdminChatThread } from "@/components/schools/AdminChatThread";
import { AlertsFeed } from "@/pages/schools/admin/alerts";
import { AttendanceHistoryList } from "@/pages/schools/student/attendance";
import { GradesList } from "@/pages/schools/student/grades";

/**
 * pages/schools/parent/reports.tsx — داشبوردِ ترکیبیِ والد (فاز ۶، بندِ ۴):
 * درخواستِ صریحِ کاربر بعد از فاز‌های ۱ تا ۵: «سامانه‌ای برایِ والدین برایِ
 * دیدنِ نتایجِ امتحانات، اخطار/هشدارِ فرزند، و نمایشِ حضور و غیاب». به‌جایِ
 * ساختنِ سه صفحه‌ی جداگانه (که تجربه‌ی «پرونده‌ی یک فرزند» را تکه‌تکه
 * می‌کرد)، همین صفحه‌ی موجودِ گزارش‌ها/چت به یک داشبوردِ تب‌دارِ واحد به‌ازایِ
 * فرزندِ انتخاب‌شده گسترش داده شد: اخطارها (تبِ اول — چون زمان‌حساس‌ترین
 * است)، نمره‌ها/نتایجِ آزمون (خواستِ صریح)، حضور و غیاب، و گزارش‌ها+چتِ
 * قبلیِ فاز ۵ (بدونِ حذفِ هیچ قابلیتِ قبلی).
 *
 * مرزِ حریمِ خصوصی: هر چهار endpointِ زیر (alerts/child, attendance/child,
 * gradebook/child, counselor/reports) سمتِ سرور با school_guardianships چک
 * می‌شوند — عیناً همان الگویِ فازِ ۵. این صفحه فقط studentMemberIdِ فرزندِ
 * انتخاب‌شده را می‌فرستد، هرگز فرض نمی‌کند سرور به آن اعتماد کرده.
 */
export default function ParentReportsPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navParentDashboard);

  const { data: children, isLoading } = useQuery({ queryKey: ["schools", "my-children"], queryFn: listMyChildren });

  const [selectedChildId, setSelectedChildId] = useState<string>("");
  useEffect(() => {
    if (!selectedChildId && children && children.length > 0) {
      setSelectedChildId(children[0].id);
    }
  }, [children, selectedChildId]);

  const selectedChild = (children ?? []).find((c: MyChild) => c.id === selectedChildId);
  const childSchoolId = selectedChild?.school?.id;

  const { data: alerts, isLoading: alertsLoading } = useQuery({
    queryKey: ["schools", "alerts", "child", childSchoolId, selectedChildId],
    queryFn: () => listChildAlerts(childSchoolId!, selectedChildId),
    enabled: !!childSchoolId && !!selectedChildId,
  });

  const { data: grades, isLoading: gradesLoading } = useQuery({
    queryKey: ["schools", "gradebook", "child", childSchoolId, selectedChildId],
    queryFn: () => getChildGradebook(childSchoolId!, selectedChildId),
    enabled: !!childSchoolId && !!selectedChildId,
  });

  const { data: attendance, isLoading: attendanceLoading } = useQuery({
    queryKey: ["schools", "attendance", "child", childSchoolId, selectedChildId],
    queryFn: () => listChildAttendance(childSchoolId!, selectedChildId),
    enabled: !!childSchoolId && !!selectedChildId,
  });

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
        <h1 className="text-xl font-bold">{t.navParentDashboard}</h1>
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

          {/* اخطارها همیشه بالایِ داشبورد هم دیده می‌شوند — زمان‌حساس‌ترین بخش، طبقِ اسپکِ فاز. */}
          {alerts && alerts.length > 0 && <AlertsFeed alerts={alerts} isLoading={alertsLoading} />}

          {childSchoolId && selectedChildId && (
            <Tabs defaultValue="grades" className="w-full">
              <TabsList>
                <TabsTrigger value="alerts" className="gap-1.5"><ShieldAlert className="size-4" /> {t.navAlerts}</TabsTrigger>
                <TabsTrigger value="grades" className="gap-1.5"><GraduationCap className="size-4" /> {t.navGrades}</TabsTrigger>
                <TabsTrigger value="attendance" className="gap-1.5"><ClipboardCheck className="size-4" /> {t.navAttendance}</TabsTrigger>
                <TabsTrigger value="reports" className="gap-1.5"><BarChart3 className="size-4" /> {t.navReports}</TabsTrigger>
                <TabsTrigger value="chat" className="gap-1.5"><MessagesSquare className="size-4" /> {t.navChat}</TabsTrigger>
              </TabsList>

              <TabsContent value="alerts" className="mt-3">
                <AlertsFeed alerts={alerts} isLoading={alertsLoading} />
              </TabsContent>

              <TabsContent value="grades" className="mt-3">
                <GradesList items={grades?.items} average={grades?.average ?? null} isLoading={gradesLoading} />
              </TabsContent>

              <TabsContent value="attendance" className="mt-3">
                <AttendanceHistoryList records={attendance} isLoading={attendanceLoading} />
              </TabsContent>

              <TabsContent value="reports" className="mt-3">
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
              </TabsContent>

              <TabsContent value="chat" className="mt-3">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><MessagesSquare className="size-4" /> {t.navChat}</CardTitle></CardHeader>
                  <CardContent>
                    <AdminChatThread schoolId={childSchoolId} studentMemberId={selectedChildId} />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}
        </>
      )}
    </div>
  );
}
