/**
 * TabBackup.tsx — بک‌آپ و بازیابی (فاز ۲۲).
 *
 * بازیابی **دو مرحله‌ای** است و مرحله‌ی اول هیچ چیزی نمی‌نویسد: سرور فقط
 * می‌گوید در هر تب چند ردیف اضافه/جایگزین/بدون‌تغییر می‌شود. نوشتن فقط وقتی
 * اتفاق می‌افتد که کاربر نام بات را تایپ کرده باشد.
 */
import { useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useMutation } from "@tanstack/react-query";
import type { Bot } from "@workspace/api-client-react";
import { Download, Upload, Loader2, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";

type PlanRow = { tab: string; added: number; replaced: number; unchanged: number; total: number };
type RestoreResult = {
  preview: boolean;
  mode: string;
  plan: PlanRow[];
  skipped: string[];
  written?: number;
};

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export function TabBackup({ bot }: { bot: Bot }) {
  const t = useT("botSettings");
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [downloading, setDownloading] = useState(false);
  const [zipDataUrl, setZipDataUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [confirmName, setConfirmName] = useState("");
  const [plan, setPlan] = useState<RestoreResult | null>(null);

  async function download() {
    setDownloading(true);
    try {
      // پاسخ یک ZIP باینری است، پس blob می‌خواهیم نه JSON.
      const blob = await customFetch<Blob>(`/api/bots/${bot.id}/backup`, { responseType: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `irforge-backup-${bot.id}-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: t.backupDownloaded });
    } catch (err: any) {
      toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) });
    } finally {
      setDownloading(false);
    }
  }

  const restore = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch<RestoreResult>(`/api/bots/${bot.id}/restore`, { method: "POST", body: JSON.stringify(body) }),
    onError: (err: any) =>
      toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  async function pickFile(file: File) {
    setFileName(file.name);
    setPlan(null);
    setConfirmName("");
    const dataUrl = await readAsDataUrl(file);
    setZipDataUrl(dataUrl);
    // پیش‌نمایش خودکار: کاربر باید قبل از هر تصمیمی بداند چه اتفاقی می‌افتد.
    restore.mutate({ zip: dataUrl, mode }, { onSuccess: setPlan });
  }

  const totals = (plan?.plan ?? []).reduce(
    (acc, row) => ({ added: acc.added + row.added, replaced: acc.replaced + row.replaced }),
    { added: 0, replaced: 0 }
  );

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t.backupTitle}</CardTitle>
          <CardDescription>{t.backupDesc}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={download} disabled={downloading}>
            {downloading ? <Loader2 className="me-2 size-4 animate-spin" /> : <Download className="me-2 size-4" />}
            {t.backupDownload}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-amber-500/40">
        <CardHeader>
          <CardTitle>{t.restoreTitle}</CardTitle>
          <CardDescription>{t.restoreDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t.restoreFile}</Label>
              <input
                ref={inputRef} type="file" accept=".zip,application/zip" className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) pickFile(file);
                }}
              />
              <Button variant="outline" className="w-full" onClick={() => inputRef.current?.click()}>
                <Upload className="me-2 size-4" /> {fileName || t.restorePick}
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="restore-mode">{t.restoreMode}</Label>
              <Select
                value={mode}
                onValueChange={(v) => {
                  const next = v as "merge" | "replace";
                  setMode(next);
                  // تغییر حالت یعنی پیش‌نمایش قبلی دیگر معتبر نیست.
                  if (zipDataUrl) restore.mutate({ zip: zipDataUrl, mode: next }, { onSuccess: setPlan });
                }}
              >
                <SelectTrigger id="restore-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="merge">{t.restoreModeMerge}</SelectItem>
                  <SelectItem value="replace">{t.restoreModeReplace}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {restore.isPending && !plan && <Loader2 className="size-4 animate-spin text-muted-foreground" />}

          {plan && (
            <div className="space-y-3">
              <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {t.restorePreviewSummary
                    .replace("{tabs}", String(plan.plan.length))
                    .replace("{added}", String(totals.added))
                    .replace("{replaced}", String(totals.replaced))}
                </span>
              </p>

              <div className="max-h-56 overflow-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="p-2 text-start font-medium">{t.restoreColTab}</th>
                      <th className="p-2 text-start font-medium">{t.restoreColAdded}</th>
                      <th className="p-2 text-start font-medium">{t.restoreColReplaced}</th>
                      <th className="p-2 text-start font-medium">{t.restoreColUnchanged}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.plan.map((row) => (
                      <tr key={row.tab} className="border-t">
                        <td className="p-2" dir="ltr">{row.tab}</td>
                        <td className="p-2 tabular-nums">{row.added}</td>
                        <td className="p-2 tabular-nums">{row.replaced}</td>
                        <td className="p-2 tabular-nums text-muted-foreground">{row.unchanged}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {plan.skipped.length > 0 && (
                <p className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span dir="ltr">{t.restoreSkipped.replace("{files}", plan.skipped.join(", "))}</span>
                </p>
              )}

              {!plan.preview ? (
                <p className="text-sm text-emerald-600 dark:text-emerald-400">
                  {t.restoreDone.replace("{n}", String(plan.written ?? 0))}
                </p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="restore-confirm">{t.restoreConfirmLabel.replace("{name}", bot.name)}</Label>
                    <Input id="restore-confirm" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />
                  </div>
                  <Button
                    variant="destructive"
                    disabled={confirmName.trim() !== bot.name.trim() || restore.isPending || !zipDataUrl}
                    onClick={() =>
                      restore.mutate(
                        { zip: zipDataUrl, mode, confirmName: confirmName.trim() },
                        {
                          onSuccess: (result) => { setPlan(result); toast({ title: t.restoreDoneTitle }); },
                        }
                      )
                    }
                  >
                    {restore.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
                    {t.restoreApply}
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
