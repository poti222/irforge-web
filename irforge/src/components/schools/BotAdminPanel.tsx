import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Copy, CheckCircle2, AlertTriangle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import {
  resyncSchoolBot, getSchoolBotDiagnostics, getSchoolBotAdminInfo, setSchoolBotPhoto,
  type SchoolBotResyncResult, type SchoolBotDiagnostics,
} from "@/lib/schools-api";
import { imageSrc, uploadImageBlob } from "./ImageUploadField";

/** عکسِ مدرسه (مثلاً WebP) → JPEG در مرورگر، چون تلگرام برایِ عکسِ پروفایلِ بات فقط JPG می‌پذیرد. */
async function photoToJpegUrl(photoUrl: string): Promise<string> {
  const res = await fetch(imageSrc(photoUrl), { credentials: "include" });
  if (!res.ok) throw new Error("fetch");
  const bmp = await createImageBitmap(await res.blob());
  const scale = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  if (!blob || blob.type !== "image/jpeg") throw new Error("encode");
  return uploadImageBlob(blob, () => {});
}

/**
 * BotAdminPanel — «اتصال بات / بروزرسانی بات» + عیب‌یابیِ ساده + (مدیر) راهنما، پیامِ دعوتِ قابلِ‌کپی و وضعیتِ اتصالِ اعضا.
 * در حالتِ `superMode` برایِ سوپرادمین (مسیرهایِ /api/super/…؛ بدونِ راهنما/اتصالِ اعضا).
 */
export function BotAdminPanel({ schoolId, photoUrl, superMode = false }: { schoolId: string; photoUrl?: string | null; superMode?: boolean }) {
  const t = useT("schools") as any;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [last, setLast] = useState<SchoolBotResyncResult | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const diagKey = ["schools", "bot", schoolId, "diag", superMode];
  const { data: diag } = useQuery<SchoolBotDiagnostics>({ queryKey: diagKey, queryFn: () => getSchoolBotDiagnostics(schoolId, superMode), retry: false });
  const { data: info } = useQuery({ queryKey: ["schools", "bot", schoolId, "admin-info"], queryFn: () => getSchoolBotAdminInfo(schoolId), enabled: !superMode, retry: false });

  const resync = useMutation({
    mutationFn: async () => {
      let r = await resyncSchoolBot(schoolId, superMode);
      if (r.photo?.status === "needs_jpeg" && photoUrl && !superMode) {
        try { r = await setSchoolBotPhoto(schoolId, await photoToJpegUrl(photoUrl)); } catch { /* همان پیامِ needs_jpeg با راهنمای دستی نمایش داده می‌شود */ }
      }
      return r;
    },
    onSuccess: (r) => {
      setLast(r);
      qc.setQueryData(diagKey, r.diagnostics);
      qc.invalidateQueries({ queryKey: ["schools", "bot", schoolId] });
      toast({ title: r.ok ? t.botPanelResyncOk : t.botPanelResyncPartial });
    },
    onError: () => toast({ variant: "destructive", title: t.botPanelResyncFail }),
  });

  const d = last?.diagnostics ?? diag;
  const problems = d?.problems ?? [];

  async function copyInvite() {
    if (!info?.inviteText) return;
    try { await navigator.clipboard.writeText(info.inviteText); toast({ title: t.botPanelCopied }); }
    catch { toast({ variant: "destructive", title: t.botPanelCopyFail }); }
  }

  return (
    <div className="space-y-3 border-t pt-3" data-testid="bot-admin-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t.botPanelHint}</p>
        <Button size="sm" variant="outline" onClick={() => resync.mutate()} disabled={resync.isPending} data-testid="bot-resync">
          {resync.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <RefreshCw className="me-2 size-4" />}
          {t.botPanelResync}
        </Button>
      </div>

      {d && (
        <div className="space-y-1.5 rounded-lg border p-3 text-sm" data-testid="bot-diagnostics">
          <div className="flex flex-wrap items-center gap-2">
            {problems.length === 0
              ? <Badge className="gap-1 bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400"><CheckCircle2 className="size-3.5" />{t.botPanelHealthy}</Badge>
              : <Badge variant="destructive" className="gap-1"><AlertTriangle className="size-3.5" />{t.botPanelHasProblems}</Badge>}
            {typeof d.pendingUpdates === "number" && <span className="text-xs text-muted-foreground">{t.botPanelPending}: {d.pendingUpdates}</span>}
          </div>
          {problems.map((p) => <p key={p} className="text-destructive">• {p}</p>)}
          {d.lastErrorDate && <p className="text-xs text-muted-foreground">{t.botPanelLastError}: {new Date(d.lastErrorDate).toLocaleString()}</p>}
        </div>
      )}

      {last && (
        <ul className="space-y-0.5 text-xs" data-testid="bot-resync-steps">
          {last.steps.map((s) => (
            <li key={s.step} className={s.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
              {s.ok ? "✓" : "✗"} {t[`botStep_${s.step}`] ?? s.step}{!s.ok && s.detail ? ` — ${s.detail}` : ""}
            </li>
          ))}
          {last.photo?.status === "needs_jpeg" && (
            <li className="text-amber-600 dark:text-amber-400">{t.botPanelPhotoManual}</li>
          )}
        </ul>
      )}

      {!superMode && info && (
        <>
          <div className="space-y-2 rounded-lg bg-primary/5 p-3 text-sm">
            <p className="font-medium">⚠️ {t.botPanelEveryoneStart}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setShowGuide((v) => !v)} data-testid="bot-guide-toggle">{showGuide ? t.botPanelHideGuide : t.botPanelShowGuide}</Button>
              <Button size="sm" onClick={copyInvite} data-testid="bot-copy-invite"><Copy className="me-2 size-4" />{t.botPanelCopyInvite}</Button>
            </div>
            {showGuide && <pre className="whitespace-pre-wrap rounded-md bg-background p-3 text-xs leading-6" dir="auto">{info.guide}</pre>}
            <Textarea readOnly value={info.inviteText} rows={6} className="text-xs" dir="auto" data-testid="bot-invite-text" />
          </div>

          <div className="space-y-2 rounded-lg border p-3 text-sm" data-testid="bot-connections">
            <p className="flex items-center gap-2 font-medium"><Users className="size-4" />{t.botPanelMembersTitle}: {info.connections.totals.connected}/{info.connections.totals.total}</p>
            {info.connections.roles.map((r) => (
              <div key={r.role}>
                <p><span className="font-medium">{r.roleFa}</span>: {r.connected}/{r.total}{r.blocked ? ` · ${t.botPanelBlocked} ${r.blocked}` : ""}</p>
                {r.notStarted.length > 0 && <p className="text-xs text-muted-foreground">{t.botPanelNotStarted}: {r.notStarted.slice(0, 30).join("، ")}{r.notStarted.length > 30 ? ` +${r.notStarted.length - 30}` : ""}</p>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
