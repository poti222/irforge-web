/**
 * PostboxTranslationsTab.tsx — IRFORGE_POSTBOX_PROMPT Phase B3
 * ─────────────────────────────────────────────────────────────────────────────
 * Per-message translations list + editor, added as a new "Translations" tab
 * onto `PostboxMessageDialog.tsx` (Phase B2's own dialog shell, deliberately
 * left ready for this). `TelegramHtmlEditor` (this same directory) is the
 * "whitelist-only rich editor" — see its own header for why there's no free
 * HTML textarea and no live rendered preview.
 *
 * The "source mode" control (Manual / API) is UI scaffolding only, disclosed
 * as such: `plugins/autoposter/domain.py` has no field for where a
 * translation's text came from, and no auto-translate provider is wired for
 * postbox (unlike the separate `translate_post` plugin, which owns its own
 * Google Translate integration end-to-end). "API" stays visibly disabled
 * with an explanatory note rather than silently omitted, so the intent is
 * legible without faking a feature this phase doesn't actually build.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Loader2, Plus, Pencil, Trash2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";
import { TelegramHtmlEditor } from "./TelegramHtmlEditor";
import type { PostboxMessageDetail, PostboxTranslation } from "./types";

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}

function TranslationForm({
  botId, messageId, translation, onDone,
}: { botId: string; messageId: string; translation: PostboxTranslation | null; onDone: () => void }) {
  const t = useT("botPostbox");
  const { toast } = useToast();
  const qc = useQueryClient();

  const [langCode, setLangCode] = useState(translation?.lang_code ?? "");
  const [langLabel, setLangLabel] = useState(translation?.lang_label ?? "");
  const [bodyHtml, setBodyHtml] = useState(translation?.body_html ?? "");
  const [status, setStatus] = useState<PostboxTranslation["status"]>(translation?.status ?? "draft");

  const save = useMutation({
    mutationFn: () => {
      const body = { lang_code: langCode, lang_label: langLabel, body_html: bodyHtml, status };
      return translation
        ? customFetch(`/api/bots/${botId}/postbox/messages/${messageId}/translations/${translation.id}`, {
            method: "PATCH", body: JSON.stringify(body),
          })
        : customFetch(`/api/bots/${botId}/postbox/messages/${messageId}/translations`, {
            method: "POST", body: JSON.stringify(body),
          });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-postbox-message", botId, messageId] });
      onDone();
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  return (
    <Card>
      <CardContent className="space-y-3 p-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="pb-tr-code">{t.fieldLangCode}</Label>
            <Input
              id="pb-tr-code" dir="ltr" value={langCode} maxLength={10}
              onChange={(e) => setLangCode(e.target.value.toLowerCase())}
              placeholder={t.langCodePlaceholder}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pb-tr-label">{t.fieldLangLabel}</Label>
            <Input
              id="pb-tr-label" value={langLabel} onChange={(e) => setLangLabel(e.target.value)}
              placeholder={t.langLabelPlaceholder}
            />
          </div>
        </div>

        <div className="space-y-1.5 rounded-md border border-dashed p-2">
          <p className="text-xs font-medium text-muted-foreground">{t.sourceModeLabel}</p>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge>{t.sourceModeManual}</Badge>
            <Badge variant="outline" className="gap-1 opacity-60">
              <Sparkles className="size-3" /> {t.sourceModeApi}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground">{t.sourceModeApiComingSoon}</p>
        </div>

        <div className="space-y-1">
          <Label>{t.fieldBody}</Label>
          <TelegramHtmlEditor value={bodyHtml} onChange={setBodyHtml} />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1.5">
            <Button
              type="button" size="sm" variant={status === "draft" ? "default" : "outline"}
              onClick={() => setStatus("draft")}
            >
              {t.statusDraft}
            </Button>
            <Button
              type="button" size="sm" variant={status === "ready" ? "default" : "outline"}
              onClick={() => setStatus("ready")}
            >
              {t.statusReady}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onDone}>{t.cancel}</Button>
            <Button
              size="sm" onClick={() => save.mutate()}
              disabled={!langCode.trim() || !bodyHtml.trim() || save.isPending}
            >
              {save.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
              {save.isPending ? t.saving : t.save}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function PostboxTranslationsTab({
  botId, detail,
}: { botId: string; detail: PostboxMessageDetail }) {
  const t = useT("botPostbox");
  const { toast } = useToast();
  const qc = useQueryClient();
  const { message, translations } = detail;

  const [editing, setEditing] = useState<PostboxTranslation | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PostboxTranslation | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/bots/${botId}/postbox/messages/${message.id}/translations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-postbox-message", botId, message.id] });
      setDeleteTarget(null);
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  if (editing) {
    return (
      <TranslationForm
        botId={botId} messageId={message.id}
        translation={editing === "new" ? null : editing}
        onDone={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="space-y-3">
      {translations.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{t.noTranslationsYet}</p>
      ) : (
        <div className="space-y-2">
          {translations.map((tr) => (
            <div key={tr.id} className="flex items-center gap-2 rounded-md border p-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium" dir="ltr">
                  {tr.lang_code} {tr.lang_label && <span className="text-muted-foreground">— {tr.lang_label}</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">{tr.body_html.replace(/<[^>]+>/g, "") || "—"}</p>
              </div>
              <Badge variant={tr.status === "ready" ? "default" : "secondary"}>
                {tr.status === "ready" ? t.statusReady : t.statusDraft}
              </Badge>
              <Button variant="ghost" size="icon" aria-label={t.editTranslation} onClick={() => setEditing(tr)}>
                <Pencil className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label={t.deleteMessage} onClick={() => setDeleteTarget(tr)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button variant="outline" className="w-full" onClick={() => setEditing("new")}>
        <Plus className="me-2 size-4" /> {t.addTranslation}
      </Button>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deleteTranslationConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.deleteTranslationConfirmDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}
              disabled={remove.isPending}
            >
              {remove.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.confirmDelete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
