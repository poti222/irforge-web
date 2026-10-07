import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Link2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";
import { useT } from "@/hooks/use-translation";
import { getSchoolMe, getMyGuardianRequests, submitGuardianRequest, cancelGuardianRequest, type GuardianRequestStatus } from "@/lib/schools-api";

/**
 * pages/schools/parent/link.tsx — «اتصال به دانش‌آموز»: والد شماره‌یِ دانش‌آموز را می‌دهد؛ پاسخِ سرور عمداً برایِ
 * شماره‌یِ پیداشده/پیدانشده یکی است (حریم)، پس UI هم هرگز چیزی بیشتر از «ارسال شد» و وضعیتِ خودِ درخواست نشان نمی‌دهد.
 */
const STATUS_KEY: Record<GuardianRequestStatus, string> = {
  pending: "grStatusPending", approved: "grStatusApproved", rejected: "grStatusRejected", expired: "grStatusExpired", cancelled: "grStatusCancelled",
};

export default function ParentLinkPage() {
  const t = useT("schools") as any;
  usePrivatePageTitle(t.grTitle);
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["schools", "me"], queryFn: getSchoolMe });
  const schoolId = me?.schoolId ?? undefined;
  const { data, isLoading } = useQuery({ queryKey: ["schools", "guardian-requests", "mine", schoolId], queryFn: () => getMyGuardianRequests(schoolId!), enabled: !!schoolId });

  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ kind: "sent" | "limit" | "daily" | "pending" | "invalid"; left?: number } | null>(null);

  async function send() {
    if (!schoolId || !phone.trim()) return;
    setBusy(true); setInfo(null);
    try {
      const r = await submitGuardianRequest(schoolId, phone.trim());
      setInfo({ kind: "sent", left: r.remainingForPhone });
      setPhone("");
      await qc.invalidateQueries({ queryKey: ["schools", "guardian-requests", "mine", schoolId] });
    } catch (err: any) {
      const code = err?.data?.code;
      if (code === "guardian_request_limit") setInfo({ kind: err.data.scope === "daily_phones" ? "daily" : "limit" });
      else if (code === "guardian_request_pending") setInfo({ kind: "pending" });
      else if (code === "invalid_phone") setInfo({ kind: "invalid" });
      else toast({ variant: "destructive", title: t.grSendError, description: err?.data?.error });
      await qc.invalidateQueries({ queryKey: ["schools", "guardian-requests", "mine", schoolId] });
    } finally { setBusy(false); }
  }

  async function cancel(id: string) {
    if (!schoolId) return;
    try {
      await cancelGuardianRequest(schoolId, id);
      await qc.invalidateQueries({ queryKey: ["schools", "guardian-requests", "mine", schoolId] });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.grSendError, description: err?.data?.error });
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.grTitle}</h1>
        <p className="text-sm text-muted-foreground">{t.grDescription}</p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gr-phone">{t.grPhoneLabel}</Label>
            <Input id="gr-phone" dir="ltr" inputMode="tel" autoComplete="off" value={phone} placeholder={t.grPhonePlaceholder} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} data-testid="gr-phone" />
            <p className="text-xs text-muted-foreground">{t.grAttemptsRule}</p>
          </div>
          <Button onClick={send} disabled={busy || !phone.trim()} className="w-fit" data-testid="gr-send">
            {busy ? <Loader2 className="me-2 size-4 animate-spin" /> : <Link2 className="me-2 size-4" />}
            {t.grSend}
          </Button>
          {info?.kind === "sent" && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm" data-testid="gr-sent">
              <p>{t.grSent}</p>
              {info.left != null && <p className="mt-1 text-xs text-muted-foreground">{t.grAttemptsLeft.replace("{n}", String(info.left))}</p>}
            </div>
          )}
          {info?.kind === "limit" && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm font-medium text-destructive" data-testid="gr-limit">{t.grLimitReached}</div>}
          {info?.kind === "daily" && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{t.grLimitDaily}</div>}
          {info?.kind === "pending" && <div className="rounded-md border p-3 text-sm">{t.grAlreadyPending}</div>}
          {info?.kind === "invalid" && <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{t.grInvalidPhone}</div>}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{t.grRequestsTitle}</h2>
        {isLoading ? <Loader2 className="size-5 animate-spin" /> : !data || data.requests.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{t.grNoRequests}</div>
        ) : data.requests.map((r) => {
          const used = data.limits.usedByPhone.find((u) => u.phone === r.phone);
          return (
            <Card key={r.id}>
              <CardContent className="flex items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium" dir="ltr">{r.phone}</div>
                  <div className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString("fa-IR")}{used ? ` · ${t.grAttemptsLeft.replace("{n}", String(used.remaining))}` : ""}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={r.status === "approved" ? "default" : r.status === "pending" ? "secondary" : "outline"}>{t[STATUS_KEY[r.status]]}</Badge>
                  {r.status === "pending" && <Button size="sm" variant="ghost" onClick={() => cancel(r.id)}>{t.grCancel}</Button>}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
