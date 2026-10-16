import { useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { AlertTriangle, CheckCircle2, Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

type Item = {
  botId: string;
  botName: string;
  oldSheetId: string;
  newSheetId: string | null;
  status: "would_repair" | "repaired" | "no_spare" | "failed";
  tablesWithData: number;
  rowsMoved: number;
  ownerNotified: boolean;
  reason?: string;
};

type Report = {
  mode: "dry" | "apply";
  pool: { total: number; inUse: number; free: number; orphans: number };
  spares: { total: number; healthy: number; broken: number; unknown: number; removed: number };
  orphans: { total: number; healthy: number; broken: number; unknown: number; wiped: number; deleted: number; rowsPurged: number };
  unknownSheets: { sheetId: string; httpStatus?: number; reason?: string }[];
  bots: {
    total: number;
    healthy: number;
    broken: number;
    unknown: number;
    repaired: number;
    wouldRepair: number;
    noSpare: number;
    failed: number;
    withoutSheet: number;
  };
  items: Item[];
  notes: string[];
};

type Status = {
  running: boolean;
  progress: { phase: string; done: number; total: number };
  report: Report | null;
  error: string | null;
};

type Stage = "idle" | "scanning" | "preview" | "applying" | "done" | "error";

const PHASE_FA: Record<string, string> = {
  probing: "در حال تست شیت‌ها",
  removing: "حذف شیت‌های خراب از pool",
  wiping: "پاک‌کردن کامل شیت‌های بی‌صاحب",
  repairing: "تعمیر شیت بات‌ها",
};

const STATUS_FA: Record<Item["status"], string> = {
  would_repair: "قابل تعمیر",
  repaired: "تعمیر شد",
  no_spare: "شیت آزاد نمانده",
  failed: "ناموفق",
};

function n(v: number) {
  return v.toLocaleString("fa-IR");
}

/**
 * دکمه‌ی «بررسی و تعمیر همه» — اول پیش‌نمایش (بدون هیچ تغییر)، بعد با تأیید
 * ادمین اجرا می‌شود. منطق در `POST /api/sheet-pool/repair`.
 */
export function SheetPoolRepair({ onDone }: { onDone?: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [status, setStatus] = useState<Status | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function poll(next: "preview" | "done") {
    customFetch<Status>("/api/sheet-pool/repair")
      .then((s) => {
        if (!alive.current) return;
        setStatus(s);
        if (s.running) {
          timer.current = setTimeout(() => poll(next), 1500);
          return;
        }
        if (s.error) {
          setErrMsg(s.error);
          setStage("error");
          return;
        }
        setStage(next);
        if (next === "done") onDone?.();
      })
      .catch((e: any) => {
        if (!alive.current) return;
        setErrMsg(e?.message ?? "خطا");
        setStage("error");
      });
  }

  async function start(apply: boolean) {
    setErrMsg(null);
    setStatus(null);
    setStage(apply ? "applying" : "scanning");
    try {
      await customFetch("/api/sheet-pool/repair", { method: "POST", body: JSON.stringify({ apply }) });
    } catch (e: any) {
      // ۴۰۹ = یک اجرای دیگر در جریان است؛ فقط به همان وصل می‌شویم.
      if (e?.status !== 409) {
        setErrMsg(e?.message ?? "شروع بررسی ممکن نشد");
        setStage("error");
        toast({ variant: "destructive", title: "خطا", description: e?.message });
        return;
      }
    }
    poll(apply ? "done" : "preview");
  }

  function openDialog() {
    setOpen(true);
    void start(false);
  }

  const report = status?.report ?? null;
  const progress = status?.progress;
  const busy = stage === "scanning" || stage === "applying";
  const hasBroken = !!report && (report.spares.broken > 0 || report.bots.broken > 0 || report.orphans.total > 0);

  return (
    <>
      <Button variant="outline" onClick={openDialog} data-testid="repair-all">
        <Wrench className="me-1.5 size-4" />
        بررسی و تعمیر همه
      </Button>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {stage === "done" ? "گزارش تعمیر" : stage === "preview" ? "پیش‌نمایش (هنوز چیزی تغییر نکرده)" : "بررسی شیت‌ها"}
            </DialogTitle>
          </DialogHeader>

          {busy && (
            <div className="flex items-center gap-3 rounded-lg border p-4 text-sm">
              <Loader2 className="size-5 shrink-0 animate-spin text-primary" />
              <div>
                <p className="font-medium">{PHASE_FA[progress?.phase ?? "probing"] ?? "در حال انجام"}</p>
                {!!progress?.total && (
                  <p className="text-xs text-muted-foreground">
                    {n(progress.done)} از {n(progress.total)}
                  </p>
                )}
              </div>
            </div>
          )}

          {stage === "error" && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 p-4 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{errMsg ?? "خطای ناشناخته"}</span>
            </div>
          )}

          {report && (stage === "preview" || stage === "done") && (
            <div className="space-y-4 text-sm">
              <p className="text-xs text-muted-foreground">
                pool: {n(report.pool.total)} شیت — {n(report.pool.inUse)} به بات وصل، {n(report.pool.free)} آزاد، {n(report.pool.orphans)} بی‌صاحب
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-3">
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">شیت‌های خالی (آزاد)</p>
                  <p>سالم: <b className="text-emerald-500">{n(report.spares.healthy)}</b></p>
                  <p>
                    خراب: <b className="text-destructive">{n(report.spares.broken)}</b>
                    {stage === "done" && <span className="text-xs text-muted-foreground"> ({n(report.spares.removed)} حذف شد)</span>}
                  </p>
                  {report.spares.unknown > 0 && <p className="text-xs text-muted-foreground">نامشخص: {n(report.spares.unknown)}</p>}
                </div>
                <div className="rounded-lg border p-3">
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">شیت‌های بی‌صاحب</p>
                  <p>
                    سالم: <b className="text-emerald-500">{n(report.orphans.healthy)}</b>
                    {stage === "done" && <span className="text-xs text-muted-foreground"> ({n(report.orphans.wiped)} پاک و آزاد شد)</span>}
                  </p>
                  <p>
                    خراب: <b className="text-destructive">{n(report.orphans.broken)}</b>
                    {stage === "done" && <span className="text-xs text-muted-foreground"> ({n(report.orphans.deleted)} حذف شد)</span>}
                  </p>
                  {report.orphans.rowsPurged > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {n(report.orphans.rowsPurged)} ردیف دیتای Postgres {stage === "done" ? "پاک شد" : "پاک می‌شود"}
                    </p>
                  )}
                  {report.orphans.unknown > 0 && <p className="text-xs text-muted-foreground">نامشخص: {n(report.orphans.unknown)}</p>}
                </div>
                <div className="rounded-lg border p-3">
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">شیت بات‌ها</p>
                  <p>سالم: <b className="text-emerald-500">{n(report.bots.healthy)}</b></p>
                  <p>
                    خراب: <b className="text-destructive">{n(report.bots.broken)}</b>
                    {stage === "done" && <span className="text-xs text-muted-foreground"> ({n(report.bots.repaired)} تعمیر شد)</span>}
                  </p>
                  {report.bots.unknown > 0 && <p className="text-xs text-muted-foreground">نامشخص: {n(report.bots.unknown)}</p>}
                </div>
              </div>

              {report.bots.noSpare > 0 && (
                <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  برای {n(report.bots.noSpare)} بات شیتِ سالمِ آزاد نمانده. اول شیت جدید به pool اضافه کن و دوباره بزن.
                </p>
              )}
              {report.bots.failed > 0 && (
                <p className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-destructive">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {n(report.bots.failed)} بات تعمیر نشد؛ دست‌نخورده روی شیت قبلی ماندند (جزئیات پایین).
                </p>
              )}
              {!hasBroken && (
                <p className="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-3 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-4" /> هیچ شیتِ خرابی پیدا نشد.
                </p>
              )}

              {report.items.length > 0 && (
                <div className="overflow-hidden rounded-lg border">
                  {report.items.map((it) => (
                    <div key={it.botId} className="flex items-start justify-between gap-3 border-b p-2.5 last:border-b-0">
                      <div className="min-w-0">
                        <p className="truncate font-medium" dir="auto">{it.botName}</p>
                        {it.reason && <p className="text-xs text-muted-foreground">{it.reason}</p>}
                        {it.rowsMoved > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {n(it.rowsMoved)} ردیف دیتا در {n(it.tablesWithData)} جدول {stage === "done" ? "منتقل شد" : "منتقل می‌شود"}
                          </p>
                        )}
                        {it.ownerNotified && <p className="text-xs text-emerald-500">به صاحب بات خبر داده شد</p>}
                      </div>
                      <span
                        className={`shrink-0 text-xs ${
                          it.status === "repaired" || it.status === "would_repair"
                            ? "text-emerald-500"
                            : it.status === "no_spare"
                              ? "text-amber-500"
                              : "text-destructive"
                        }`}
                      >
                        {STATUS_FA[it.status]}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {report.unknownSheets.length > 0 && (
                <div className="rounded-lg border p-3 text-xs text-muted-foreground">
                  <p className="mb-1 font-medium">شیت‌های نامشخص (دست نخوردند):</p>
                  {report.unknownSheets.map((u) => (
                    <p key={u.sheetId} dir="ltr" className="truncate">
                      {u.sheetId.slice(0, 10)}… — {u.httpStatus ?? "?"} {u.reason ?? ""}
                    </p>
                  ))}
                </div>
              )}

              {report.notes.map((t, i) => (
                <p key={i} className="text-xs text-muted-foreground">{t}</p>
              ))}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            {stage === "preview" && hasBroken && (
              <Button onClick={() => start(true)} data-testid="repair-apply">
                <Wrench className="me-1.5 size-4" />
                تعمیر همه
              </Button>
            )}
            {!busy && (
              <Button variant="outline" onClick={() => setOpen(false)}>
                بستن
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
