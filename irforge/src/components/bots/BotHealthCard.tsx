/**
 * BotHealthCard.tsx — «سلامت بات» در سکشن نمای کلی (فاز ۲۴).
 *
 * هر مورد یک دکمه‌ی «رفع» دارد که به همان سکشنی می‌برد که آنجا درست می‌شود؛
 * مواردی که سرور `repairable` علامتشان زده با یک کلیک روی `/panels/repair`
 * درست می‌شوند.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { Loader2, CheckCircle2, AlertTriangle, XCircle, Wrench, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";

type Issue = {
  code: string;
  severity: "error" | "warning";
  detail: string;
  section: string;
  repairable: boolean;
};

type HealthResponse = {
  issues: Issue[];
  healthy: boolean;
  errorCount: number;
  warningCount: number;
  infrastructure: { cacheBust: boolean; queue: boolean; cutoverFlags: Record<string, boolean> };
  counts: { panels: number; forms: number };
};

export function BotHealthCard({ bot }: { bot: Bot }) {
  const t = useT("botHealth");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const search = useSearch();

  const key = ["bot-health", bot.id] as const;
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => customFetch<HealthResponse>(`/api/bots/${bot.id}/health`),
    // یک بات بدون شیت ۴۰۹ می‌دهد؛ کارت به‌جای خطا فقط پنهان می‌شود.
    retry: false,
  });

  const repair = useMutation({
    mutationFn: () => customFetch<{ fixed: number }>(`/api/bots/${bot.id}/panels/repair`, { method: "POST" }),
    onSuccess: ({ fixed }) => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["bot-panels", bot.id] });
      toast({ title: t.repairDone.replace("{n}", String(fixed)) });
    },
  });

  function goToSection(section: string) {
    const params = new URLSearchParams(search);
    params.set("section", section);
    params.delete("tab");
    params.delete("panel");
    params.delete("form");
    navigate(`/bots/${bot.id}?${params.toString()}`);
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t.loading}
        </CardContent>
      </Card>
    );
  }
  // بدون شیت یا هر خطای دیگر: کارت سلامت چیزی برای گفتن ندارد و ساکت می‌ماند،
  // به‌جای اینکه یک خطای قرمز بالای نمای کلی بگذارد.
  if (error || !data) return null;

  const anyRepairable = data.issues.some((i) => i.repairable);

  return (
    <Card className={data.healthy ? undefined : data.errorCount > 0 ? "border-destructive/40" : "border-amber-500/40"}>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {data.healthy ? (
            <><CheckCircle2 className="size-4 text-emerald-500" /> {t.healthyTitle}</>
          ) : (
            <>
              <AlertTriangle className="size-4 text-amber-500" />
              {t.issuesTitle}
              {data.errorCount > 0 && <Badge variant="destructive">{t.errorCount.replace("{n}", String(data.errorCount))}</Badge>}
              {data.warningCount > 0 && <Badge variant="secondary">{t.warningCount.replace("{n}", String(data.warningCount))}</Badge>}
            </>
          )}
          {anyRepairable && (
            <Button
              variant="outline" size="sm" className="ms-auto"
              disabled={repair.isPending} onClick={() => repair.mutate()}
            >
              {repair.isPending ? <Loader2 className="me-1.5 size-4 animate-spin" /> : <Wrench className="me-1.5 size-4" />}
              {t.repairCta}
            </Button>
          )}
        </CardTitle>
        <CardDescription>{data.healthy ? t.healthyDesc : t.issuesDesc}</CardDescription>
      </CardHeader>

      {!data.healthy && (
        <CardContent className="space-y-2">
          {data.issues.map((issue, i) => (
            <div key={i} className="flex flex-wrap items-start gap-2 rounded-md border p-2 text-sm">
              {issue.severity === "error" ? (
                <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              ) : (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
              )}
              <span className="min-w-0 flex-1">{issue.detail}</span>
              <Button variant="ghost" size="sm" onClick={() => goToSection(issue.section)}>
                {t.fixCta} <ArrowLeft className="ms-1.5 size-3.5 rtl-flip" />
              </Button>
            </div>
          ))}

          <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            {data.infrastructure.cacheBust ? t.infraCacheFast : t.infraCacheSlow}
            {" · "}
            {data.infrastructure.queue ? t.infraQueueOn : t.infraQueueOff}
          </p>
        </CardContent>
      )}
    </Card>
  );
}
