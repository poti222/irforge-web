/**
 * PostboxMessageDialog.tsx — IRFORGE_POSTBOX_PROMPT Phase B2 (+ B3/B4 add tabs here)
 * ─────────────────────────────────────────────────────────────────────────────
 * One message's detail/editor: "Content" (edit if composed, read-only note if
 * forwarded — its content only exists on Telegram) and "Publish" (channel
 * picker + slow mode + queue feedback, plus this message's own publish
 * history). Phase B3 adds a "Translations" tab and Phase B4 a "Buttons" tab
 * to this same component, rather than three separate dialogs, so an admin
 * managing one post has one place to do it — mirrors `CatalogSection.tsx`'s
 * own item editor (media/body/fulfillment/buttons all in one dialog).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Loader2, X, Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";
import { PostboxTranslationsTab } from "./PostboxTranslationsTab";
import { PostboxButtonsTab } from "./PostboxButtonsTab";
import type {
  PostboxChannel, PostboxMessageDetail, PostboxPublishResult, PostboxTarget,
} from "./types";

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}

function ContentTab({ botId, detail }: { botId: string; detail: PostboxMessageDetail }) {
  const t = useT("botPostbox");
  const { toast } = useToast();
  const qc = useQueryClient();
  const { message } = detail;
  const [title, setTitle] = useState(message.title);
  const [bodyHtml, setBodyHtml] = useState(message.body_html);

  const save = useMutation({
    mutationFn: () =>
      customFetch(`/api/bots/${botId}/postbox/messages/${message.id}`, {
        method: "PATCH", body: JSON.stringify({ title, body_html: bodyHtml }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-postbox-message", botId, message.id] });
      qc.invalidateQueries({ queryKey: ["bot-postbox-messages", botId] });
      toast({ title: t.save });
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  if (message.source_type === "forwarded") {
    return (
      <div className="space-y-3">
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{t.forwardedContentNote}</p>
        {message.preview_text && (
          <div className="space-y-1.5">
            <Label>{t.previewLabel}</Label>
            <p className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">{message.preview_text}</p>
          </div>
        )}
      </div>
    );
  }

  const dirty = title !== message.title || bodyHtml !== message.body_html;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="pb-edit-title">{t.fieldTitle}</Label>
        <Input id="pb-edit-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.titlePlaceholder} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pb-edit-body">{t.fieldBody}</Label>
        <Textarea id="pb-edit-body" rows={8} value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} />
      </div>
      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={!dirty || !bodyHtml.trim() || save.isPending}>
          {save.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
          {save.isPending ? t.saving : t.save}
        </Button>
      </div>
    </div>
  );
}

function targetStatusBadge(status: PostboxTarget["status"], t: Record<string, string>) {
  const label = t[`targetStatus_${status}`] ?? status;
  if (status === "sent") return <Badge>{label}</Badge>;
  if (status === "failed") return <Badge variant="destructive">{label}</Badge>;
  return <Badge variant="secondary">{label}</Badge>;
}

function PublishTab({ botId, detail }: { botId: string; detail: PostboxMessageDetail }) {
  const t = useT("botPostbox");
  const { toast } = useToast();
  const qc = useQueryClient();
  const { message, targets } = detail;

  const { data: known } = useQuery({
    queryKey: ["bot-postbox-channels", botId],
    queryFn: () => customFetch<{ channels: PostboxChannel[] }>(`/api/bots/${botId}/postbox/channels`),
  });

  const [picked, setPicked] = useState<PostboxChannel[]>([]);
  const [newId, setNewId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [slowMode, setSlowMode] = useState(false);
  const [results, setResults] = useState<PostboxPublishResult[] | null>(null);

  function addChannel(channelId: string, channelTitle: string) {
    const id = channelId.trim();
    if (!id || picked.some((c) => c.channel_id === id)) return;
    setPicked((prev) => [...prev, { channel_id: id, channel_title: channelTitle.trim() }]);
  }

  const publish = useMutation({
    mutationFn: () =>
      customFetch<{ results: PostboxPublishResult[] }>(`/api/bots/${botId}/postbox/messages/${message.id}/publish`, {
        method: "POST", body: JSON.stringify({ channels: picked, slow_mode: slowMode }),
      }),
    onSuccess: (res) => {
      setResults(res.results);
      setPicked([]);
      qc.invalidateQueries({ queryKey: ["bot-postbox-message", botId, message.id] });
      qc.invalidateQueries({ queryKey: ["bot-postbox-channels", botId] });
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const knownNotPicked = (known?.channels ?? []).filter((c) => !picked.some((p) => p.channel_id === c.channel_id));

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        {picked.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {picked.map((c) => (
              <Badge key={c.channel_id} variant="secondary" className="gap-1 ps-2.5 pe-1">
                <span dir="ltr">{c.channel_title || c.channel_id}</span>
                <button
                  type="button" aria-label={t.removeChannel}
                  onClick={() => setPicked((prev) => prev.filter((p) => p.channel_id !== c.channel_id))}
                  className="rounded-full p-0.5 hover:bg-black/10"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        {knownNotPicked.length > 0 && (
          <Select value="" onValueChange={(v) => {
            const ch = knownNotPicked.find((c) => c.channel_id === v);
            if (ch) addChannel(ch.channel_id, ch.channel_title);
          }}>
            <SelectTrigger><SelectValue placeholder={t.knownChannelsLabel} /></SelectTrigger>
            <SelectContent>
              {knownNotPicked.map((c) => (
                <SelectItem key={c.channel_id} value={c.channel_id}>
                  <span dir="ltr">{c.channel_title || c.channel_id}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Input
            dir="ltr" className="min-w-40 flex-1" value={newId} onChange={(e) => setNewId(e.target.value)}
            placeholder={t.channelIdPlaceholder}
          />
          <Input
            className="min-w-32 flex-1" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
            placeholder={t.channelTitlePlaceholder}
          />
          <Button
            type="button" variant="outline" size="icon" aria-label={t.addChannel}
            onClick={() => { addChannel(newId, newTitle); setNewId(""); setNewTitle(""); }}
            disabled={!newId.trim()}
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border p-3">
        <div>
          <p className="text-sm">{t.slowMode}</p>
          <p className="text-xs text-muted-foreground">{t.slowModeDesc}</p>
        </div>
        <Switch checked={slowMode} onCheckedChange={setSlowMode} />
      </div>

      {picked.length === 0 && <p className="text-xs text-muted-foreground">{t.publishRequiresChannel}</p>}

      <Button className="w-full" onClick={() => publish.mutate()} disabled={picked.length === 0 || publish.isPending}>
        {publish.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <Send className="me-2 size-4" />}
        {publish.isPending ? t.publishing : t.publish}
      </Button>

      {results && (
        <div className="space-y-1.5 rounded-md border bg-muted/40 p-3">
          <p className="text-sm font-medium">{t.publishResultsTitle}</p>
          {results.map((r) => (
            <p key={r.targets[0]?.id} className="text-xs text-muted-foreground">
              <span dir="ltr">{r.targets[0]?.channel_title || r.targets[0]?.channel_id}</span>
              {" — "}
              {r.eta_minutes <= 0 ? t.etaImmediate : t.etaMinutes.replace("{n}", String(r.eta_minutes))}
            </p>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium">{t.targetsSectionTitle}</p>
        {targets.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t.noTargetsYet}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[28rem] text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2 text-start font-medium">{t.colChannel}</th>
                  <th className="p-2 text-start font-medium">{t.colStatus}</th>
                  <th className="p-2 text-start font-medium">{t.colSentAt}</th>
                  <th className="p-2 text-start font-medium">{t.colError}</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((tg) => (
                  <tr key={tg.id} className="border-t">
                    <td className="p-2" dir="ltr">{tg.channel_title || tg.channel_id}</td>
                    <td className="p-2">{targetStatusBadge(tg.status, t as unknown as Record<string, string>)}</td>
                    <td className="p-2" dir="ltr">{tg.sent_at ? tg.sent_at.slice(0, 16).replace("T", " ") : "—"}</td>
                    <td className="p-2 text-destructive">{tg.error || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function PostboxMessageDialog({
  botId, messageId, onClose,
}: { botId: string; messageId: string; onClose: () => void }) {
  const t = useT("botPostbox");
  const [tab, setTab] = useState("content");

  const { data, isLoading, error } = useQuery({
    queryKey: ["bot-postbox-message", botId, messageId],
    queryFn: () => customFetch<PostboxMessageDetail>(`/api/bots/${botId}/postbox/messages/${messageId}`),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>{t.messageDetailTitle}</DialogTitle></DialogHeader>

        {isLoading && (
          <div className="flex items-center gap-2 p-6 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t.loading}
          </div>
        )}
        {!isLoading && (error || !data) && (
          <p className="p-6 text-center text-sm text-muted-foreground">{errMessage(error, t.errorGeneric)}</p>
        )}

        {data && (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="content">{t.tabContent}</TabsTrigger>
              <TabsTrigger value="translations">{t.tabTranslations}</TabsTrigger>
              <TabsTrigger value="buttons">{t.tabButtons}</TabsTrigger>
              <TabsTrigger value="publish">{t.tabPublish}</TabsTrigger>
            </TabsList>
            <TabsContent value="content"><ContentTab botId={botId} detail={data} /></TabsContent>
            <TabsContent value="translations"><PostboxTranslationsTab botId={botId} detail={data} /></TabsContent>
            <TabsContent value="buttons"><PostboxButtonsTab botId={botId} detail={data} /></TabsContent>
            <TabsContent value="publish"><PublishTab botId={botId} detail={data} /></TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
