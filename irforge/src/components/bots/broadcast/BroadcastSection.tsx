/**
 * BroadcastSection.tsx — پیام همگانی (فاز ۱۵).
 *
 * سه محدودیتِ واقعیِ قرارداد صفِ بات که این UI صادقانه نشانشان می‌دهد به‌جای
 * اینکه فیلدی بدهد و بی‌صدا دورش بریزد:
 *   - گیرنده‌ها را خود job تعیین می‌کند (همه‌ی کاربران غیر‌بن‌شده)، پس عدد اینجا
 *     یک **تخمین** است و فیلتر دلخواه وجود ندارد.
 *   - دکمه‌ی شیشه‌ای پشتیبانی نمی‌شود، چون `copy_message` بدون `reply_markup`
 *     صدا زده می‌شود.
 *   - بدون Postgres بات، ارسال اصلاً ممکن نیست (۵۰۳ با پیام روشن).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { Loader2, Send, AlertTriangle, Info, Bot as BotIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";

type BroadcastStatus = {
  queueAvailable: boolean;
  estimatedRecipients: number;
  totalUsers: number;
  history: Array<{
    id: string;
    status: string;
    attempts: number;
    last_error: string | null;
    created_at: number;
    updated_at: number;
  }>;
};

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}

export function BroadcastSection({ bot }: { bot: Bot }) {
  const t = useT("botBroadcast");
  const { lang } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["bot-broadcast", bot.id],
    queryFn: () => customFetch<BroadcastStatus>(`/api/bots/${bot.id}/broadcast`),
  });

  const send = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch<{ jobId: string; estimatedRecipients: number }>(`/api/bots/${bot.id}/broadcast`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bot-broadcast", bot.id] }),
  });

  const [text, setText] = useState("");
  const [mediaFileId, setMediaFileId] = useState("");
  const [mediaType, setMediaType] = useState("photo");
  const [confirmText, setConfirmText] = useState("");

  const nf = (n: number) => n.toLocaleString(lang === "fa" ? "fa-IR" : "en-US");

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t.loading}
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {errCode(error) === "no_sheet" ? t.noSheetYet : errMessage(error, t.errorGeneric)}
      </div>
    );
  }

  const recipients = data.estimatedRecipients;
  // تأیید دو مرحله‌ای: کاربر باید تعداد گیرندگان را تایپ کند. عدد لاتین پذیرفته
  // می‌شود چون همان چیزی است که در فیلد نشان داده می‌شود.
  const confirmed = confirmText.trim() === String(recipients);
  const canSend = data.queueAvailable && (text.trim() || mediaFileId) && confirmed && recipients > 0;

  return (
    <div className="max-w-2xl space-y-4">
      {!data.queueAvailable && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{t.queueUnavailable}</span>
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t.composerTitle}</CardTitle>
          <CardDescription>{t.composerDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bc-text">{t.messageText}</Label>
            <Textarea id="bc-text" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
            <p className="text-xs text-muted-foreground tabular-nums">{text.length} / 4000</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="bc-media">{t.mediaFileId}</Label>
              <Input
                id="bc-media" dir="ltr" className="font-mono text-sm"
                value={mediaFileId}
                onChange={(e) => setMediaFileId(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bc-media-type">{t.mediaType}</Label>
              <Select value={mediaType} onValueChange={setMediaType}>
                <SelectTrigger id="bc-media-type" className="min-w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="photo">{t.mediaPhoto}</SelectItem>
                  <SelectItem value="video">{t.mediaVideo}</SelectItem>
                  <SelectItem value="audio">{t.mediaAudio}</SelectItem>
                  <SelectItem value="document">{t.mediaDocument}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* پیش‌نمایش — همان چیزی که کاربر می‌گیرد. */}
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">{t.previewTitle}</p>
            <div className="flex gap-2">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <BotIcon className="size-4" />
              </div>
              <div className="min-w-0 flex-1 rounded-lg rounded-ss-none border bg-card p-3 text-sm shadow-sm">
                {mediaFileId && (
                  <p className="mb-2 rounded border border-dashed bg-muted/50 p-2 text-xs text-muted-foreground">
                    {t.previewMedia}
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words">
                  {text || <span className="text-muted-foreground">{t.previewEmpty}</span>}
                </p>
              </div>
            </div>
          </div>

          <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>{t.noButtonsNotice}</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.confirmTitle}</CardTitle>
          <CardDescription>{t.audienceNotice}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3 text-sm">
            <Badge variant="secondary">{t.statRecipients.replace("{n}", nf(recipients))}</Badge>
            <Badge variant="outline">{t.statTotal.replace("{n}", nf(data.totalUsers))}</Badge>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bc-confirm">{t.confirmLabel.replace("{n}", String(recipients))}</Label>
            <Input
              id="bc-confirm" dir="ltr"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              aria-invalid={confirmText !== "" && !confirmed ? true : undefined}
            />
          </div>

          <Button
            disabled={!canSend || send.isPending}
            onClick={() =>
              send.mutate(
                {
                  text,
                  mediaFileId: mediaFileId || undefined,
                  mediaType: mediaFileId ? mediaType : undefined,
                  confirmRecipients: recipients,
                },
                {
                  onSuccess: (result) => {
                    toast({
                      title: t.queued,
                      description: t.queuedDesc.replace("{n}", nf(result.estimatedRecipients)),
                    });
                    setText(""); setMediaFileId(""); setConfirmText("");
                  },
                  onError: (err: any) =>
                    toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
                }
              )
            }
          >
            {send.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <Send className="me-2 size-4" />}
            {t.sendCta}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.historyTitle}</CardTitle>
          <CardDescription>{t.historyDesc}</CardDescription>
        </CardHeader>
        <CardContent>
          {data.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noHistory}</p>
          ) : (
            <ul className="space-y-2">
              {data.history.map((job) => (
                <li key={job.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
                  <Badge
                    variant={job.status === "done" ? "default" : job.status === "failed" ? "destructive" : "secondary"}
                  >
                    {t[`status_${job.status}` as keyof typeof t] as string ?? job.status}
                  </Badge>
                  <span dir="ltr" className="text-xs text-muted-foreground">
                    {new Date(job.created_at * 1000).toISOString().slice(0, 16).replace("T", " ")}
                  </span>
                  {job.last_error && (
                    <span className="min-w-0 flex-1 truncate text-xs text-destructive">{job.last_error}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
