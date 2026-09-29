import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, BarChart3, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { getSchoolMe, listCounselorStudents, listCounselorReports, createCounselorReport } from "@/lib/schools-api";

/**
 * pages/schools/counselor/reports.tsx — «گزارش‌ها» (فاز ۴، بندِ ۱): برخلافِ
 * یادداشتِ محرمانه (counselor/students.tsx)، این گزارش‌ها را مدیر/معاونِ همان
 * مدرسه هم می‌بینند (ببینید کارتِ خواندنیِ متناظر در admin/index.tsx).
 */
export default function CounselorReportsPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navReports);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;

  const { data: students } = useQuery({
    queryKey: ["schools", "counselor-students", schoolId],
    queryFn: () => listCounselorStudents(schoolId!),
    enabled: !!schoolId,
  });

  const { data: reports, isLoading } = useQuery({
    queryKey: ["schools", "counselor-reports", schoolId],
    queryFn: () => listCounselorReports(schoolId!),
    enabled: !!schoolId,
  });

  const [studentMemberId, setStudentMemberId] = useState<string>("none");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!schoolId || !title.trim() || !body.trim()) return;
    setSaving(true);
    try {
      await createCounselorReport(schoolId, { title: title.trim(), body: body.trim(), studentMemberId: studentMemberId === "none" ? null : studentMemberId });
      await queryClient.invalidateQueries({ queryKey: ["schools", "counselor-reports", schoolId] });
      setTitle(""); setBody(""); setStudentMemberId("none");
      toast({ title: t.reportSaved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.reportSaveError, description: err?.data?.error });
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navReports}</h1>
        <p className="text-sm text-muted-foreground">{t.counselorReportsDescription}</p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t.addReportButton}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t.fieldReportStudent}</Label>
            <Select value={studentMemberId} onValueChange={setStudentMemberId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t.reportGeneralOption}</SelectItem>
                {(students ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.grade ?? "—"} · {s.userId}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t.fieldReportTitle}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t.fieldReportBody}</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
          </div>
          <Button onClick={handleCreate} disabled={saving || !title.trim() || !body.trim()} className="w-fit">
            {saving ? <Loader2 className="me-2 size-4 animate-spin" /> : <Plus className="me-2 size-4" />}
            {t.addReportButton}
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 font-medium"><BarChart3 className="size-4" /> {t.reportsListTitle}</h2>
        {!reports || reports.length === 0 ? (
          <div className="flex h-24 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{t.reportsEmpty}</div>
        ) : (
          reports.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-col gap-1 py-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{r.title}</span>
                  <span className="text-xs text-muted-foreground" dir="ltr">{new Date(r.createdAt).toLocaleString()}</span>
                </div>
                {r.studentMemberId && (
                  <span className="text-xs text-muted-foreground">
                    {t.fieldReportStudent}: {(students ?? []).find((s) => s.id === r.studentMemberId)?.userId ?? r.studentMemberId}
                  </span>
                )}
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{r.body}</p>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
