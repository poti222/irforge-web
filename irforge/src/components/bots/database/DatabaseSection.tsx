/**
 * DatabaseSection.tsx — IRFORGE_PAID_SQL_DATABASE_PROMPT
 * ─────────────────────────────────────────────────────────────────────────────
 * Self-serve counterpart to the superadmin-only "Sheets Import" tool
 * (pages/admin-sheets-import.tsx, whose status-badge/progress visual
 * language this reuses): a bot owner picks between Google Sheets (free,
 * default) and SQL/Postgres (paid, `priceToman` once — unlimited, no
 * recurring charge — wallet-charged) for where this ONE bot's entire data
 * lives, and can move it back later.
 *
 * `GET .../database` (lib/botDatabase.ts::getBotDatabaseStatus, server-side)
 * always computes `mode` live — never cached. `mode` reports "sql" the
 * moment the purchase clears (billing), even before every entity has
 * necessarily finished copying in the background; `importInFlight`/
 * `exportInFlight` (independent of `mode`) drive this file's own separate
 * "still copying N/M" progress note and the migrating/reverting badges for
 * a transfer the superadmin tool started instead (that path never sets
 * billing, so `mode` there still waits for `postgresEntityCount` to reach
 * `totalEntityCount` exactly as it always has).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { useState } from "react";
import { Database, Cloud, Loader2, RotateCw, ArrowRightLeft, CheckCircle2, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";
import { formatToman } from "@/lib/format";

type ImportRequestRow = {
  id: string;
  status: string;
  entitiesDone: string[];
  entitiesFailed: { entity: string; error: string }[];
  attemptCount: number;
  nextAttemptAt: string | null;
};

type BotDatabaseMode = "sheets" | "migrating" | "reverting" | "sql";

type BotDatabaseStatus = {
  mode: BotDatabaseMode;
  postgresEntityCount: number;
  totalEntityCount: number;
  sqlExpiresAt: string | null;
  unlimited: boolean;
  importInFlight: boolean;
  exportInFlight: boolean;
  latestImportRequest: ImportRequestRow | null;
  latestExportRequest: ImportRequestRow | null;
  priceToman: number;
};

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}

export function DatabaseSection({ bot }: { bot: Bot }) {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const t = useT("botDatabase");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirmActivate, setConfirmActivate] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ["bot-database", bot.id],
    queryFn: () => customFetch<BotDatabaseStatus>(`/api/bots/${bot.id}/database`),
    refetchInterval: (query) => {
      const s = query.state.data as BotDatabaseStatus | undefined;
      // importInFlight/exportInFlight هم چک می‌شود، نه فقط mode: یک تننتِ
      // خریداری‌کرده همان لحظه‌ی خرید mode="sql" می‌گیرد، ولی مهاجرتِ
      // واقعی هنوز پشتِ‌صحنه در جریان است — بدونِ این، شمارشگرِ پیشرفت
      // (X/Y) تا رفرشِ دستیِ بعدی همان‌جا یخ می‌زد.
      return s?.mode === "migrating" || s?.mode === "reverting" || s?.importInFlight || s?.exportInFlight
        ? 4000
        : false;
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["bot-database", bot.id] });
    qc.invalidateQueries({ queryKey: ["bots"] });
  };

  const activate = useMutation({
    mutationFn: () => customFetch(`/api/bots/${bot.id}/database/activate-sql`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: t.activateSuccessTitle, description: t.activateSuccessDescription });
      invalidate();
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const revert = useMutation({
    mutationFn: () => customFetch(`/api/bots/${bot.id}/database/revert-to-sheets`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: t.revertSuccessTitle, description: t.revertSuccessDescription });
      invalidate();
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  if (isLoading || !status) {
    return (
      <Card className="animate-pulse">
        <CardContent className="h-40" />
      </Card>
    );
  }

  const noSheet = !bot.sheetId;
  const progress = status.totalEntityCount > 0 ? Math.round((status.postgresEntityCount / status.totalEntityCount) * 100) : 0;
  const busy = activate.isPending || revert.isPending;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
      </div>

      {noSheet ? (
        <Card>
          <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Info className="size-4 shrink-0" />
            {t.noSheetNotice}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Sheets card */}
            <Card className={status.mode === "sheets" ? "border-primary/50 ring-1 ring-primary/20" : ""}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Cloud className="size-4" />
                  {t.sheetsTitle}
                  {status.mode === "sheets" && (
                    <Badge className="gap-1 bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400">
                      <CheckCircle2 className="size-3" /> {t.activeBadge}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>{t.sheetsDescription}</CardDescription>
              </CardHeader>
              <CardContent>
                <Badge variant="outline" className="text-[10px]">{t.freeBadge}</Badge>
              </CardContent>
            </Card>

            {/* SQL card */}
            <Card className={status.mode === "sql" ? "border-primary/50 ring-1 ring-primary/20" : ""}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Database className="size-4" />
                  {t.sqlTitle}
                  {status.mode === "sql" && (
                    <Badge className="gap-1 bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400">
                      <CheckCircle2 className="size-3" /> {t.activeBadge}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>{t.sqlDescription}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm font-medium">{t.priceLabel}: {formatToman(status.priceToman, lang)} ({t.oneTimeLabel})</p>

                {status.mode === "sql" && status.unlimited && (
                  <p className="text-xs text-muted-foreground">{t.unlimitedNote}</p>
                )}

                {/* پرداختِ یک‌باره‌ای که مهاجرتِ همه‌ی جدول‌ها را می‌خرد — وضعیت
                    همان لحظه‌ی خرید "sql" می‌شود، حتی اگر پشتِ‌صحنه هنوز چند
                    جدول در حالِ کپی‌شدن باشند؛ این بخش فقط همان پیشرفت را
                    جداگانه نشان می‌دهد، بدونِ اینکه برچسبِ اصلی را عوض کند. */}
                {status.mode === "sql" && status.importInFlight && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      {t.stillMigratingNote
                        .replace("{n}", String(status.postgresEntityCount))
                        .replace("{m}", String(status.totalEntityCount))}
                    </div>
                    <Progress value={progress} />
                  </div>
                )}

                {(status.mode === "migrating" || status.mode === "reverting") && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      {status.mode === "migrating" ? t.migratingBadge : t.revertingBadge}
                      <span className="ms-auto" dir="ltr">
                        {status.mode === "migrating"
                          ? `${status.postgresEntityCount}/${status.totalEntityCount}`
                          : `${status.totalEntityCount - status.postgresEntityCount}/${status.totalEntityCount}`}
                      </span>
                    </div>
                    <Progress value={status.mode === "migrating" ? progress : 100 - progress} />
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  {status.mode === "sheets" && (
                    <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => setConfirmActivate(true)}>
                      {activate.isPending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRightLeft className="size-4" />}
                      {t.activateCta}
                    </Button>
                  )}
                  {status.mode === "sql" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      disabled={busy || status.importInFlight}
                      onClick={() => setConfirmRevert(true)}
                    >
                      {revert.isPending ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
                      {t.revertCta}
                    </Button>
                  )}
                  {(status.mode === "migrating" || status.mode === "reverting") && (
                    <Badge variant="secondary" className="gap-1">
                      <Loader2 className="size-3 animate-spin" /> {t.transferInProgress}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {status.latestImportRequest?.entitiesFailed?.length ? (
            <Card className="border-destructive/40">
              <CardContent className="p-4 text-xs text-destructive">
                {t.someEntitiesFailed.replace("{n}", String(status.latestImportRequest.entitiesFailed.length))}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}

      <AlertDialog open={confirmActivate} onOpenChange={setConfirmActivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.activateConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.activateConfirmDescription.replace("{price}", formatToman(status.priceToman, lang))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { activate.mutate(); setConfirmActivate(false); }}>
              {t.activateCta}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmRevert} onOpenChange={setConfirmRevert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.revertConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.revertConfirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { revert.mutate(); setConfirmRevert(false); }}>
              {t.revertCta}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
