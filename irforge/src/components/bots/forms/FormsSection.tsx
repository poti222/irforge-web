/**
 * FormsSection.tsx — سکشن مستقل «فرم‌ها»: لیست، ساخت، ویرایش، حذف.
 * فرمِ در حال ویرایش از URL می‌آید (`?section=forms&form=<id>`)، مثل پنل‌ها.
 */
import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import type { Bot } from "@workspace/api-client-react";
import { Plus, Loader2, Trash2, FileText, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";
import { confirmDiscardUnsaved } from "@/lib/unsaved-changes";
import { FormEditor } from "./FormEditor";
import {
  apiErrorCode, apiErrorMessage, useCreateForm, useDeleteForm, useFormReferences, useForms,
  type BotForm,
} from "./api";

/** حذف فرم: اول ارجاعات، بعد تأیید — همان الگوی پنل‌ها. */
function DeleteFormDialog({
  botId,
  form,
  open,
  onOpenChange,
  onDeleted,
}: {
  botId: string;
  form: BotForm | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const t = useT("botForms");
  const { toast } = useToast();
  const references = useFormReferences(botId, open && form ? form.id : null);
  const remove = useDeleteForm(botId);

  const total =
    (references.data?.panels.length ?? 0) +
    (references.data?.buttons.length ?? 0) +
    (references.data?.commands.length ?? 0);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5 shrink-0" />
            {t.deleteTitle.replace("{name}", form?.title ?? "")}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-start">
              <p>{t.deleteIntro}</p>
              {references.isLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : total === 0 ? (
                <p className="text-sm text-muted-foreground">{t.deleteNoReferences}</p>
              ) : (
                <ul className="list-inside list-disc text-sm">
                  {references.data!.panels.map((p) => (
                    <li key={p.id}>{t.refPanel.replace("{name}", p.title || p.id)}</li>
                  ))}
                  {references.data!.buttons.map((b, i) => (
                    <li key={i}>{t.refButton.replace("{button}", b.label).replace("{panel}", b.panelTitle || b.panelId)}</li>
                  ))}
                  {references.data!.commands.map((c) => (
                    <li key={c.command} dir="ltr">/{c.command}</li>
                  ))}
                </ul>
              )}
              {total > 0 && <p className="text-sm text-amber-600 dark:text-amber-400">{t.deleteBreaksRefs}</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>{t.cancel}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 hover:bg-red-700"
            disabled={remove.isPending}
            onClick={(e) => {
              e.preventDefault();
              if (!form) return;
              remove.mutate(form.id, {
                onSuccess: () => {
                  toast({ title: t.formDeleted });
                  onOpenChange(false);
                  onDeleted();
                },
                onError: (err: any) =>
                  toast({ variant: "destructive", title: t.errorGeneric, description: apiErrorMessage(err, t.errorGeneric) }),
              });
            }}
          >
            {remove.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {t.deleteConfirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function FormsSection({ bot }: { bot: Bot }) {
  const t = useT("botForms");
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const search = useSearch();

  const { data, isLoading, error } = useForms(bot.id);
  const create = useCreateForm(bot.id);

  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BotForm | null>(null);

  const selectedId = new URLSearchParams(search).get("form");
  const forms = data?.forms ?? [];
  const selected = forms.find((f) => f.id === selectedId) ?? null;

  function openForm(formId: string | null) {
    if (!confirmDiscardUnsaved()) return;
    const params = new URLSearchParams(search);
    params.set("section", "forms");
    if (formId) params.set("form", formId);
    else params.delete("form");
    navigate(`/bots/${bot.id}?${params.toString()}`);
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t.loading}
      </div>
    );
  }

  if (error || !data) {
    const code = apiErrorCode(error);
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {code === "no_sheet" ? t.noSheetYet : apiErrorMessage(error, t.errorGeneric)}
      </div>
    );
  }

  if (selectedId && !selected) {
    return (
      <div className="space-y-3 rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p>{t.formGone}</p>
        <Button variant="outline" size="sm" onClick={() => openForm(null)}>{t.backToList}</Button>
      </div>
    );
  }

  if (selected) {
    return <FormEditor botId={bot.id} form={selected} onBack={() => openForm(null)} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t.sectionDesc}</p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="me-1.5 size-4" /> {t.createFormCta}
        </Button>
      </div>

      {forms.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t.noForms}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-start font-medium">{t.colTitle}</th>
                <th className="p-2 text-start font-medium">{t.colFields}</th>
                <th className="p-2 text-start font-medium">{t.colDestination}</th>
                <th className="p-2 text-start font-medium">{t.colStatus}</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {forms.map((form) => (
                <tr key={form.id} className="border-t">
                  <td className="p-2">
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-start hover:text-primary hover:underline"
                      onClick={() => openForm(form.id)}
                    >
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      {form.title || t.untitledForm}
                    </button>
                  </td>
                  <td className="p-2 tabular-nums">{form.fields?.length ?? 0}</td>
                  <td className="p-2" dir="ltr">
                    {form.destination_group || <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-2">
                    <Badge variant={form.is_active ? "default" : "secondary"}>
                      {form.is_active ? t.statusActive : t.statusInactive}
                    </Badge>
                  </td>
                  <td className="p-2 text-end">
                    <Button variant="ghost" size="icon" aria-label={t.deleteCta} onClick={() => setDeleteTarget(form)}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) { setNewTitle(""); setCreateError(null); }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.createFormTitle}</DialogTitle>
            <DialogDescription>{t.createFormDesc}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="new-form-title">{t.formTitle}</Label>
            <Input
              id="new-form-title"
              value={newTitle}
              autoFocus
              onChange={(e) => { setNewTitle(e.target.value); setCreateError(null); }}
              aria-invalid={Boolean(createError) || undefined}
            />
            {createError && <p className="text-sm text-destructive">{createError}</p>}
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                if (!newTitle.trim()) {
                  setCreateError(t.errorTitleRequired);
                  return;
                }
                create.mutate(
                  { title: newTitle.trim(), fields: [] },
                  {
                    onSuccess: ({ form }) => {
                      toast({ title: t.formCreated });
                      setCreateOpen(false);
                      setNewTitle("");
                      openForm(form.id);
                    },
                    onError: (err: any) => setCreateError(apiErrorMessage(err, t.errorGeneric)),
                  }
                );
              }}
              disabled={create.isPending}
            >
              {create.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.createFormCta}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteFormDialog
        botId={bot.id}
        form={deleteTarget}
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onDeleted={() => setDeleteTarget(null)}
      />
    </div>
  );
}
