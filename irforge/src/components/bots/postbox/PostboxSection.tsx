/**
 * PostboxSection.tsx — IRFORGE_POSTBOX_PROMPT Phase B2
 * ─────────────────────────────────────────────────────────────────────────────
 * "پست‌ساز" (Post Studio) admin UI, Part B of the postbox feature (Part A,
 * irforge-app, built the data model + forward-ingestion + publish engine +
 * translation delivery). This phase: the message list, a composer for
 * text-only ("composed") messages, delete, and the publish flow (channel
 * picker + slow mode + per-target queued/eta feedback) — talking to
 * `routes/postbox.ts`/`lib/postboxStore.ts` (irforge-web).
 *
 * A message's own "Translations" and "Buttons" management live in
 * `PostboxMessageDialog.tsx`'s own tabs; this phase builds the dialog shell
 * with only "Content" + "Publish" — Phase B3 adds a "Translations" tab,
 * Phase B4 a "Buttons" tab, onto the same file/dialog rather than a rebuild,
 * so the admin ends up with one coherent per-message editor instead of three
 * disconnected screens.
 *
 * Same `showWhenDisabled` pattern as `translatePost`/`booking`/`catalog`:
 * the section never disappears, it shows an activation CTA when the
 * `autoposter` plugin is off (`BotWorkspaceDocument.tsx`).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { Newspaper, Loader2, Plus, Trash2, Forward, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";
import { PostboxMessageDialog } from "./PostboxMessageDialog";
import type { PostboxMessage } from "./types";

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}

function MessageComposer({ botId, onClose }: { botId: string; onClose: () => void }) {
  const t = useT("botPostbox");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");

  const create = useMutation({
    mutationFn: () =>
      customFetch<{ message: PostboxMessage }>(`/api/bots/${botId}/postbox/messages`, {
        method: "POST", body: JSON.stringify({ title, body_html: bodyHtml }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-postbox-messages", botId] });
      onClose();
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t.composerTitle}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pb-title">{t.fieldTitle}</Label>
            <Input id="pb-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.titlePlaceholder} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pb-body">{t.fieldBody}</Label>
            <Textarea
              id="pb-body" rows={8} value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)}
              placeholder={t.bodyPlaceholder}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t.cancel}</Button>
          <Button onClick={() => create.mutate()} disabled={!bodyHtml.trim() || create.isPending}>
            {create.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {create.isPending ? t.saving : t.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PostboxSection({ bot }: { bot: Bot }) {
  const t = useT("botPostbox");
  const { toast } = useToast();
  const qc = useQueryClient();

  const messagesKey = ["bot-postbox-messages", bot.id];
  const { data, isLoading, error } = useQuery({
    queryKey: messagesKey,
    queryFn: () => customFetch<{ messages: PostboxMessage[] }>(`/api/bots/${bot.id}/postbox/messages`),
  });

  const activate = useMutation({
    mutationFn: () =>
      customFetch(`/api/bots/${bot.id}/plugins/autoposter`, { method: "PATCH", body: JSON.stringify({ enabled: true }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-plugins", bot.id] });
      qc.invalidateQueries({ queryKey: messagesKey });
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const [showComposer, setShowComposer] = useState(false);
  const [openMessageId, setOpenMessageId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PostboxMessage | null>(null);

  const deleteMessage = useMutation({
    mutationFn: (id: string) => customFetch(`/api/bots/${bot.id}/postbox/messages/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: messagesKey });
      setDeleteTarget(null);
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t.loading}
      </div>
    );
  }

  if (errCode(error) === "plugin_disabled") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <Newspaper className="size-8 text-muted-foreground" />
          <p className="font-semibold">{t.pluginDisabledTitle}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t.pluginDisabledDesc}</p>
          <Button onClick={() => activate.mutate()} disabled={activate.isPending}>
            {activate.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {activate.isPending ? t.activating : t.activatePlugin}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {errCode(error) === "no_sheet" ? t.noSheetYet : errMessage(error, t.errorGeneric)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button onClick={() => setShowComposer(true)}>
          <Plus className="me-2 size-4" /> {t.newMessage}
        </Button>
      </div>

      {data.messages.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{t.noMessagesYet}</p>
      ) : (
        <div className="space-y-2">
          {data.messages.map((m) => (
            <Card key={m.id} className="cursor-pointer transition-colors hover:bg-muted/40" onClick={() => setOpenMessageId(m.id)}>
              <CardContent className="flex items-center gap-3 p-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                  {m.source_type === "forwarded" ? <Forward className="size-4" /> : <PenLine className="size-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.title || t.untitled}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.preview_text || m.body_html.replace(/<[^>]+>/g, "") || "—"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge variant={m.source_type === "forwarded" ? "secondary" : "outline"}>
                    {m.source_type === "forwarded" ? t.forwardedBadge : t.composedBadge}
                  </Badge>
                  {m.is_album && <Badge variant="outline">{t.albumBadge}</Badge>}
                </div>
                <Button
                  variant="ghost" size="icon" aria-label={t.deleteMessage}
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(m); }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showComposer && <MessageComposer botId={bot.id} onClose={() => setShowComposer(false)} />}

      {openMessageId && (
        <PostboxMessageDialog botId={bot.id} messageId={openMessageId} onClose={() => setOpenMessageId(null)} />
      )}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deleteMessageConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.deleteMessageConfirmDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMessage.mutate(deleteTarget.id)}
              disabled={deleteMessage.isPending}
            >
              {deleteMessage.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.confirmDelete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
