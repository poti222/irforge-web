import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { DatabaseBackup, Loader2, Database, Cloud, CheckCircle2, XCircle, Clock, History, RotateCw, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshButton } from "@/components/ui/refresh-button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";

type ImportRequestRow = {
  id: string;
  tenantId: string;
  entities: string[] | null;
  status: string;
  requestedBy: string | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  entitiesDone: string[];
  entitiesSkipped: string[];
  entitiesFailed: { entity: string; error: string }[];
  attemptCount: number;
  nextAttemptAt: string | null;
  updatedAt: string;
};

/** آینه‌ی services/sheets_import.py::RETRY_MAX_TOTAL_SECONDS — بودجه‌ی
 * واقعیِ worker، نه یک عددِ جداگانه‌ی اختراعی. */
const RETRY_MAX_TOTAL_MINUTES = 30;

/** درخواستی که هنوز تمام نشده — هم پنل باید تا وقتی یکی از این‌هاست poll
 * کند، هم دکمه‌ی «مهاجرت» باید غیرفعال بماند. */
const IN_FLIGHT_STATUSES = new Set(["pending", "running", "retrying"]);

function isInFlight(status: string | undefined): boolean {
  return !!status && IN_FLIGHT_STATUSES.has(status);
}

type TenantImportStatus = {
  tenantId: string;
  postgresEntityCount: number;
  totalEntityCount: number;
  latestRequest: ImportRequestRow | null;
};

type BotRow = {
  id: string;
  name: string;
  username: string | null;
  sheetId: string | null;
  owner: { id: string; name: string; email: string } | null;
  status: TenantImportStatus | null;
};

function statusBadge(status: string | undefined, fa: boolean) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="secondary" className="gap-1">
          <Clock className="size-3" /> {fa ? "در صف" : "Pending"}
        </Badge>
      );
    case "running":
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="size-3 animate-spin" /> {fa ? "در حال اجرا" : "Running"}
        </Badge>
      );
    case "retrying":
      return (
        <Badge className="gap-1 bg-amber-500/15 text-amber-600 hover:bg-amber-500/15 dark:text-amber-400">
          <RotateCw className="size-3" /> {fa ? "در انتظار محدودیت شیت" : "Waiting on Sheets limit"}
        </Badge>
      );
    case "done":
      return (
        <Badge className="gap-1 bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400">
          <CheckCircle2 className="size-3" /> {fa ? "انجام شد" : "Done"}
        </Badge>
      );
    case "partial":
      return (
        <Badge className="gap-1 bg-amber-500/15 text-amber-600 hover:bg-amber-500/15 dark:text-amber-400">
          <TriangleAlert className="size-3" /> {fa ? "ناقص" : "Partial"}
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="size-3" /> {fa ? "ناموفق" : "Failed"}
        </Badge>
      );
    default:
      return null;
  }
}

function nextRetryCaption(nextAttemptAt: string | null, fa: boolean): string | null {
  if (!nextAttemptAt) return null;
  const seconds = Math.max(0, Math.round((new Date(nextAttemptAt).getTime() - Date.now()) / 1000));
  if (seconds <= 0) return fa ? "تلاش بعدی به‌زودی" : "Retrying shortly";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const label = minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
  return fa ? `تلاش بعدی تا ${label} دیگر` : `Next retry in ${label}`;
}

export default function AdminSheetsImport() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmBot, setConfirmBot] = useState<BotRow | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const { data: bots, isLoading, error } = useQuery({
    queryKey: ["admin", "sheets-import", "bots"],
    queryFn: () => customFetch<BotRow[]>("/api/superadmin/sheets-import/bots"),
    // اگر هر باتی هنوز در حالِ مهاجرت است (شامل retrying)، هر ۵ ثانیه دوباره
    // بخوان تا شمارشگرِ N/83 و بجِ وضعیت بدونِ نیازِ کاربر به رفرش دستی
    // بالا بیاید -- دقیقاً همان چیزی که کاربر خواسته بود.
    refetchInterval: (query) => {
      const rows = query.state.data as BotRow[] | undefined;
      return rows?.some((b) => isInFlight(b.status?.latestRequest?.status)) ? 5000 : false;
    },
  });

  const { data: requests } = useQuery({
    queryKey: ["admin", "sheets-import", "requests"],
    queryFn: () => customFetch<ImportRequestRow[]>("/api/superadmin/sheets-import/requests"),
    enabled: showHistory,
    refetchInterval: (query) => {
      if (!showHistory) return false;
      const rows = query.state.data as ImportRequestRow[] | undefined;
      return rows?.some((r) => isInFlight(r.status)) ? 5000 : false;
    },
  });

  const migrateOne = useMutation({
    mutationFn: (bot: BotRow) => customFetch(`/api/superadmin/sheets-import/${bot.id}`, { method: "POST" }),
    onSuccess: async (_data, bot) => {
      toast({
        title: fa ? `صف شد: ${bot.name}` : `Queued: ${bot.name}`,
        description: fa
          ? "بات به محض اینکه worker خودش این درخواست را بردارد، اطلاعاتش از شیت به Postgres منتقل می‌شود."
          : "The bot's own worker will pick this up and copy its Sheets data into Postgres.",
      });
      await queryClient.invalidateQueries({ queryKey: ["admin", "sheets-import"] });
    },
    onError: (e: any) => {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: e?.message });
    },
  });

  const migrateBulk = useMutation({
    mutationFn: (botIds: string[]) =>
      customFetch<{ results: { botId: string; ok: boolean; error?: string }[] }>("/api/superadmin/sheets-import/bulk", {
        method: "POST",
        body: JSON.stringify({ botIds }),
      }),
    onSuccess: async (data) => {
      const ok = data.results.filter((r) => r.ok).length;
      const failed = data.results.length - ok;
      toast({
        title: fa ? `${ok} بات صف شد` : `${ok} bots queued`,
        description: failed > 0 ? (fa ? `${failed} بات صف نشد (شیت ندارند).` : `${failed} skipped (no sheet).`) : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["admin", "sheets-import"] });
    },
    onError: (e: any) => {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: e?.message });
    },
  });

  const migratable = useMemo(
    () => (bots ?? []).filter((b) => b.sheetId && !(b.status?.postgresEntityCount ?? 0) && !isInFlight(b.status?.latestRequest?.status)),
    [bots]
  );

  const fullyMigrated = (bots ?? []).filter(
    (b) => b.status && b.status.totalEntityCount > 0 && b.status.postgresEntityCount === b.status.totalEntityCount
  ).length;
  const inFlight = (bots ?? []).filter((b) => isInFlight(b.status?.latestRequest?.status)).length;
  const withSheet = (bots ?? []).filter((b) => b.sheetId).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <DatabaseBackup className="size-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">
            {fa ? "مهاجرت اطلاعات از شیت" : "Sheets Import"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {fa
              ? "اطلاعات فعلیِ هر بات از Google Sheets خوانده و توی Postgres بازنویسی می‌شود؛ فقط همان بات (نه بقیه) روی Postgres فعال می‌شود. شیت به‌عنوان بکاپ دست‌نخورده می‌ماند."
              : "Reads a bot's current Google Sheets data and rewrites it into Postgres, then activates Postgres for that one bot only. Sheets stays untouched as a backup."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {fa
              ? `معمولاً هر بات تا ${RETRY_MAX_TOTAL_MINUTES} دقیقه طول می‌کشد — اگر به محدودیتِ خواندنِ شیت گوگل بخورد، خودش خودکار دوباره تلاش می‌کند تا تمام شود، بدونِ نیاز به کلیکِ دوباره.`
              : `Usually finishes within ~${RETRY_MAX_TOTAL_MINUTES} minutes per bot — if it hits Google Sheets' rate limit, it automatically retries on its own until done, no re-click needed.`}
          </p>
        </div>
        <RefreshButton
          className="ms-auto shrink-0"
          queryKeys={[["admin", "sheets-import"]]}
          label={fa ? "به‌روزرسانی" : "Refresh"}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{fa ? "کل بات‌ها" : "Total bots"}</p>
            <p className="text-2xl font-bold">{bots?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{fa ? "دارای شیت" : "With a sheet"}</p>
            <p className="text-2xl font-bold">{withSheet}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{fa ? "کامل روی Postgres" : "Fully on Postgres"}</p>
            <p className="text-2xl font-bold text-emerald-500">{fullyMigrated}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{fa ? "در حال مهاجرت" : "In flight"}</p>
            <p className="text-2xl font-bold text-amber-500">{inFlight}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={migratable.length === 0 || migrateBulk.isPending}
          onClick={() => setConfirmBulk(true)}
          data-testid="button-migrate-all"
        >
          {migrateBulk.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : null}
          {fa ? `مهاجرت همه (${migratable.length})` : `Migrate all (${migratable.length})`}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setShowHistory((v) => !v)} data-testid="button-toggle-history">
          <History className="me-2 size-4" />
          {showHistory ? (fa ? "پنهان کردن تاریخچه" : "Hide history") : (fa ? "تاریخچه‌ی درخواست‌ها" : "Request history")}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="h-16" />
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card className="border-destructive/40">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {fa ? "دریافت فهرست ممکن نشد. دسترسی سوپرادمین لازمه." : "Couldn't load the list. Super-admin access is required."}
          </CardContent>
        </Card>
      ) : !bots || bots.length === 0 ? (
        <div className="rounded-xl border border-dashed py-14 text-center">
          <DatabaseBackup className="mx-auto mb-3 size-9 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{fa ? "هیچ باتی پیدا نشد." : "No bots found."}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          {bots.map((bot, i) => {
            const status = bot.status;
            const latest = status?.latestRequest;
            const busy = isInFlight(latest?.status) || migrateOne.isPending;
            const complete = !!status && status.totalEntityCount > 0 && status.postgresEntityCount === status.totalEntityCount;
            const retryCaption = latest?.status === "retrying" ? nextRetryCaption(latest.nextAttemptAt, fa) : null;
            return (
              <motion.div
                key={bot.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.01 }}
                className="flex flex-wrap items-center gap-3 border-b p-3 last:border-b-0 hover:bg-muted/30"
                data-testid={`sheets-import-row-${bot.id}`}
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{bot.name}</span>
                  <span className="block truncate text-xs text-muted-foreground" dir="ltr">
                    {bot.username ? `@${bot.username}` : bot.id} · {bot.owner?.name ?? bot.owner?.email ?? "?"}
                  </span>
                  {retryCaption && (
                    <span className="block truncate text-[11px] text-amber-600 dark:text-amber-400">
                      {retryCaption}
                      {latest && latest.attemptCount > 1 ? ` · ${fa ? "تلاش" : "attempt"} ${latest.attemptCount}` : ""}
                    </span>
                  )}
                </div>

                {!bot.sheetId ? (
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {fa ? "بدون شیت" : "No sheet"}
                  </Badge>
                ) : (
                  <>
                    <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                      {complete ? <Database className="size-3.5 text-emerald-500" /> : <Cloud className="size-3.5" />}
                      {status ? `${status.postgresEntityCount}/${status.totalEntityCount}` : "—"}
                    </div>
                    {statusBadge(latest?.status, fa)}
                    <Button
                      size="sm"
                      variant={complete ? "outline" : "default"}
                      disabled={busy || complete}
                      onClick={() => setConfirmBot(bot)}
                      data-testid={`button-migrate-${bot.id}`}
                    >
                      {busy ? <Loader2 className="me-1.5 size-3.5 animate-spin" /> : null}
                      {complete ? (fa ? "کامل شده" : "Complete") : fa ? "مهاجرت به Postgres" : "Migrate to Postgres"}
                    </Button>
                  </>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {showHistory && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <h2 className="text-sm font-semibold">{fa ? "آخرین درخواست‌ها" : "Recent requests"}</h2>
            {!requests || requests.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">{fa ? "درخواستی ثبت نشده." : "No requests yet."}</p>
            ) : (
              <div className="space-y-1.5">
                {requests.map((r) => {
                  const retryCaption = r.status === "retrying" ? nextRetryCaption(r.nextAttemptAt, fa) : null;
                  return (
                    <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-xs" data-testid={`request-row-${r.id}`}>
                      <span className="min-w-0 flex-1 truncate font-mono" dir="ltr">
                        {r.tenantId}
                      </span>
                      {statusBadge(r.status, fa)}
                      <span className="text-muted-foreground" dir="ltr">
                        {new Date(r.requestedAt).toLocaleString(fa ? "fa-IR" : "en-US")}
                      </span>
                      {r.entitiesDone.length > 0 && (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          {fa ? `${r.entitiesDone.length} موفق` : `${r.entitiesDone.length} done`}
                        </span>
                      )}
                      {r.entitiesFailed.length > 0 && (
                        <span className="text-destructive">
                          {fa ? `${r.entitiesFailed.length} ناموفق` : `${r.entitiesFailed.length} failed`}
                        </span>
                      )}
                      {retryCaption && <span className="text-amber-600 dark:text-amber-400">{retryCaption}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!confirmBot} onOpenChange={(o) => !o && setConfirmBot(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fa ? "مهاجرت این بات؟" : "Migrate this bot?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {fa
                ? `اطلاعات فعلی «${confirmBot?.name}» از Google Sheets خوانده و توی Postgres بازنویسی می‌شود؛ بعد از آن این بات از Postgres اطلاعاتش را می‌خواند/می‌نویسد، نه دیگر از شیت. شیت دست‌نخورده می‌ماند.`
                : `«${confirmBot?.name}»'s current data will be read from Google Sheets and rewritten into Postgres; afterwards this bot reads/writes through Postgres, not Sheets. Sheets stays untouched.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmBot) migrateOne.mutate(confirmBot);
                setConfirmBot(null);
              }}
              data-testid="button-confirm-migrate"
            >
              {fa ? "مهاجرت کن" : "Migrate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmBulk} onOpenChange={setConfirmBulk}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fa ? "مهاجرت همه‌ی بات‌ها؟" : "Migrate all bots?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {fa
                ? `${migratable.length} بات که هنوز روی Postgres نیستند صف می‌شوند. هرکدام جدا و مستقل پردازش می‌شوند و برای محافظت از دیتابیس مشترک همزمان محدود اجرا می‌شوند (نه همه در یک لحظه) — اگر یکی به محدودیتِ شیت گوگل بخورد یا خطا بدهد، خودش خودکار دوباره تلاش می‌کند و بقیه ادامه پیدا می‌کنند.`
                : `${migratable.length} bots not yet on Postgres will be queued. Each is processed independently, with a bounded number running at once to protect the shared database (not literally all at the same instant) — if one hits Google's Sheets rate limit or fails, it retries automatically and the rest continue.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                migrateBulk.mutate(migratable.map((b) => b.id));
                setConfirmBulk(false);
              }}
              data-testid="button-confirm-migrate-all"
            >
              {fa ? "مهاجرت کن" : "Migrate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
