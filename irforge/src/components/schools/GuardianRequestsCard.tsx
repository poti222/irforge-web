import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { listIncomingGuardianRequests, decideGuardianRequest } from "@/lib/schools-api";

/** کارتِ خانه‌یِ دانش‌آموز: درخواست‌هایِ اتصالِ والد (فقط نامِ والد) با تأیید/رد. بدونِ درخواست، چیزی نمایش نمی‌دهد. */
export function GuardianRequestsCard({ schoolId }: { schoolId: string | undefined }) {
  const t = useT("schools") as any;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ["schools", "guardian-requests", "incoming", schoolId], queryFn: () => listIncomingGuardianRequests(schoolId!), enabled: !!schoolId });
  if (!data || data.length === 0) return null;

  async function decide(id: string, decision: "approve" | "reject") {
    setBusyId(id);
    try {
      await decideGuardianRequest(schoolId!, id, decision);
      toast({ title: t.grDecided });
      await qc.invalidateQueries({ queryKey: ["schools", "guardian-requests", "incoming", schoolId] });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.grDecideError, description: err?.data?.error });
      await qc.invalidateQueries({ queryKey: ["schools", "guardian-requests", "incoming", schoolId] });
    } finally { setBusyId(null); }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="guardian-requests-card">
      {data.map((r) => (
        <Card key={r.id} className="border-primary/40">
          <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <Link2 className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <div className="text-sm font-semibold">{t.grIncomingTitle}</div>
                <div className="text-sm text-muted-foreground">{t.grIncomingBody.replace("{name}", r.parentName)}</div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={busyId === r.id} onClick={() => decide(r.id, "approve")}>{t.grApprove}</Button>
              <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => decide(r.id, "reject")}>{t.grReject}</Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
