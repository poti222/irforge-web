import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ShieldAlert, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { useViewedSchoolId } from "@/hooks/use-viewed-school";
import {
  getSchoolMe, listSchoolMembers, listSchoolAlerts, createStudentAlert,
  ALERT_SEVERITIES, type AlertSeverity, type StudentAlert,
} from "@/lib/schools-api";

const SEVERITY_VARIANT: Record<AlertSeverity, "default" | "destructive" | "outline" | "secondary"> = {
  notice: "outline",
  warning: "secondary",
  serious: "destructive",
};

/**
 * pages/schools/admin/alerts.tsx — «اخطارها» (فاز ۶، بندِ ۴): صدور و فهرستِ
 * اخطار/هشدارِ انضباطیِ دانش‌آموز. اولین صفحه‌ای که deputy_discipline
 * («معاونِ انضباطی») یک قابلیتِ واقعاً مجزا از deputy دارد — تا این‌جا
 * ناوبریِ این دو نقش کاملاً یکسان بود. admin/deputy هم صادر/می‌بینند، چون
 * مدیرِ مدرسه هم باید بتواند مستقیماً اخطار ثبت کند.
 */
export default function SchoolAlertsPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navAlerts);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = useViewedSchoolId(me?.schoolId);

  const { data: members } = useQuery({ queryKey: ["schools", "members", schoolId], queryFn: () => listSchoolMembers(schoolId!), enabled: !!schoolId });
  const students = (members ?? []).filter((m) => m.role === "student");

  const { data: alerts, isLoading } = useQuery({
    queryKey: ["schools", "alerts", schoolId],
    queryFn: () => listSchoolAlerts(schoolId!),
    enabled: !!schoolId,
  });

  const [showForm, setShowForm] = useState(false);
  const [studentMemberId, setStudentMemberId] = useState("");
  const [severity, setSeverity] = useState<AlertSeverity>("notice");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!schoolId || !studentMemberId || !title.trim() || !body.trim()) return;
    setSaving(true);
    try {
      await createStudentAlert(schoolId, { studentMemberId, severity, title: title.trim(), body: body.trim() });
      await queryClient.invalidateQueries({ queryKey: ["schools", "alerts", schoolId] });
      setTitle(""); setBody(""); setStudentMemberId(""); setSeverity("notice"); setShowForm(false);
      toast({ title: t.alertSaved });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.alertSaveError, description: err?.data?.error });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{t.navAlerts}</h1>
          <p className="text-sm text-muted-foreground">{t.alertsPageDescription}</p>
        </div>
        <Button size="sm" variant={showForm ? "secondary" : "default"} onClick={() => setShowForm((s) => !s)}>
          <Plus className="me-1 size-4" /> {t.issueAlertButton}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            <div className="flex flex-col gap-1.5">
              <Label>{t.fieldStudent}</Label>
              <Select value={studentMemberId} onValueChange={setStudentMemberId}>
                <SelectTrigger><SelectValue placeholder={t.selectMemberPlaceholder} /></SelectTrigger>
                <SelectContent>
                  {students.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.userName ?? s.userEmail ?? s.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5 sm:w-56">
              <Label>{t.fieldSeverity}</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as AlertSeverity)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALERT_SEVERITIES.map((sv) => (
                    <SelectItem key={sv} value={sv}>{t[`alertSeverity_${sv}`]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t.fieldAlertTitle}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t.fieldAlertBody}</Label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
            </div>
            <Button onClick={handleCreate} disabled={saving || !studentMemberId || !title.trim() || !body.trim()} className="w-fit">
              {saving && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.saveButton}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="size-4" /> {t.alertsListTitle}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          {isLoading ? (
            <Loader2 className="size-5 animate-spin" />
          ) : !alerts || alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.alertsEmpty}</p>
          ) : (
            alerts.map((a) => {
              const person = students.find((s) => s.id === a.studentMemberId);
              return (
                <div key={a.id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{a.title}</span>
                    <Badge variant={SEVERITY_VARIANT[a.severity]}>{t[`alertSeverity_${a.severity}`]}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{person?.userName ?? person?.userEmail ?? a.studentMemberId}</p>
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{a.body}</p>
                  <p className="mt-2 text-xs text-muted-foreground" dir="ltr">{new Date(a.createdAt).toLocaleString()}</p>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** فهرستِ فقط‌خواندنیِ اخطارها — بازاستفاده در داشبوردِ خودِ دانش‌آموز و داشبوردِ والد. */
export function AlertsFeed({ alerts, isLoading }: { alerts: StudentAlert[] | undefined; isLoading: boolean }) {
  const t = useT("schools") as any;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="size-4 text-destructive" /> {t.navAlerts}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-2">
        {isLoading ? (
          <Loader2 className="size-5 animate-spin" />
        ) : !alerts || alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.alertsEmpty}</p>
        ) : (
          alerts.map((a) => (
            <div key={a.id} className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{a.title}</span>
                <Badge variant={SEVERITY_VARIANT[a.severity]}>{t[`alertSeverity_${a.severity}`]}</Badge>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{a.body}</p>
              <p className="mt-2 text-xs text-muted-foreground" dir="ltr">{new Date(a.createdAt).toLocaleString()}</p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
