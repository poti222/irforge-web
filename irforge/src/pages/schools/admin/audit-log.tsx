import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, History } from "lucide-react";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { useViewedSchoolId } from "@/hooks/use-viewed-school";
import { getSchoolMe, listSchoolAuditLog } from "@/lib/schools-api";

/**
 * pages/schools/admin/audit-log.tsx — «تاریخچه» (فاز ۹، بندِ ۳): فهرستِ
 * فقط‌خواندنیِ رخدادهایِ مدیریتیِ همین مدرسه، جدیدترین اول. عمداً فیلتر/
 * صفحه‌بندی ندارد — این یک لاگِ حداقلی‌ست، نه یک داشبوردِ گزارش‌گیری.
 */
export default function SchoolAuditLogPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.navAuditLog);

  const { data: me, isLoading: meLoading } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = useViewedSchoolId(me?.schoolId);

  const { data: entries, isLoading } = useQuery({
    queryKey: ["schools", "audit-log", schoolId],
    queryFn: () => listSchoolAuditLog(schoolId!),
    enabled: !!schoolId,
  });

  if (meLoading) return <Loader2 className="size-6 animate-spin" />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.navAuditLog}</h1>
        <p className="text-sm text-muted-foreground">{t.auditLogDescription}</p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><History className="size-4" /> {t.navAuditLog}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          {isLoading ? (
            <Loader2 className="size-5 animate-spin" />
          ) : !entries || entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.auditLogEmpty}</p>
          ) : (
            entries.map((e) => (
              <div key={e.id} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="outline">{t[`auditAction_${e.action}`] ?? e.action}</Badge>
                  <span className="text-xs text-muted-foreground" dir="ltr">{new Date(e.createdAt).toLocaleString()}</span>
                </div>
                <p>{e.targetDescription}</p>
                <p className="text-xs text-muted-foreground">{t.auditLogActor}: {e.actorName ?? e.actorUserId}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
