/**
 * PostboxButtonsTab.tsx — IRFORGE_POSTBOX_PROMPT Phase B4
 * ─────────────────────────────────────────────────────────────────────────────
 * Per-message inline-keyboard builder, added as a third tab onto
 * `PostboxMessageDialog.tsx` (Phases B2/B3's dialog was left ready for
 * exactly this — one more `TabsTrigger`/`TabsContent`, no rebuild).
 *
 * Row/col reordering uses the SAME "arrows, not drag" convention
 * `panels/ButtonBuilder.tsx` already established, and for the same reason
 * that component's own header states: dragging inside a scrolling list
 * doesn't work reliably on mobile, and ↑↓←→ is unambiguous in both RTL/LTR.
 * The two components don't share code, though — `PanelButton`'s shape
 * (`action`/`value`, column position implied by array order within a row)
 * and `PostboxButton`'s shape (`kind`/`target`, explicit `row`/`col`
 * integers, no bulk-save endpoint — each button is its own create/update/
 * delete call) are different enough that reusing `lib/panel-buttons.ts`'s
 * helpers directly would mean fighting the type system more than the small
 * amount of duplication is worth. The admin never sees or edits a raw
 * row/col number either way — same lesson `ButtonBuilder.tsx` already
 * learned from its own bug B9.
 *
 * Row/col model: `row`/`col` are plain integers on each button, not
 * necessarily contiguous (a button could be on row 0 and row 5 with nothing
 * between if that's how they were created). Rows are therefore *distinct
 * row values*, not a separate entity — moving a button up/down swaps its
 * `row` value with the adjacent distinct row's; left/right swaps `col`
 * with the adjacent button in the same row. Deleting the last button in a
 * row makes that row value simply stop appearing; nothing to clean up.
 *
 * The style picker's caption (`styleOldClientHint`) is the one thing
 * irforge-app's own Phase A4 explicitly deferred here: `aiogram==3.30.0`
 * already sends the real Bot API 9.4 `style` field, but an older Telegram
 * client simply ignores it and renders the default button chrome -- there
 * is nothing to branch on bot-side (it has no way to know which client
 * version is rendering a given tap), so that entry said the caveat "stays
 * a UI hint for whoever authors button labels in Phase B4's web builder."
 * This is that hint.
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  Loader2, Plus, Pencil, Trash2, ArrowUp, ArrowDown, ArrowRight, ArrowLeft, Rows3, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { usePanels } from "../panels/api";
import type { PostboxButton, PostboxMessageDetail } from "./types";

const STYLE_SWATCH: Record<PostboxButton["style"], string> = {
  default: "bg-muted text-foreground border",
  primary: "bg-blue-500 text-white",
  success: "bg-emerald-500 text-white",
  danger: "bg-red-500 text-white",
};

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}

function groupByRow(buttons: PostboxButton[]): PostboxButton[][] {
  const rowValues = [...new Set(buttons.map((b) => b.row))].sort((a, b) => a - b);
  return rowValues.map((row) =>
    buttons.filter((b) => b.row === row).sort((a, b) => a.col - b.col),
  );
}

function TelegramPreview({ rows, botId }: { rows: PostboxButton[][]; botId: string }) {
  const t = useT("botPostbox");
  void botId;
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{t.previewLabel}</p>
      <div className="max-w-xs space-y-1 rounded-2xl rounded-bs-sm bg-background p-2 shadow-sm">
        <div className="h-3 w-24 rounded bg-muted" />
        <div className="h-3 w-40 rounded bg-muted" />
        <div className="mt-2 space-y-1">
          {rows.map((row, i) => (
            <div key={i} className="flex gap-1">
              {row.map((b) => (
                <span
                  key={b.id}
                  className={`flex-1 truncate rounded-md px-2 py-1 text-center text-xs ${STYLE_SWATCH[b.style]}`}
                >
                  {b.label}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ButtonForm({
  botId, messageId, translations, button, defaultRow, onDone,
}: {
  botId: string; messageId: string; translations: PostboxMessageDetail["translations"];
  button: PostboxButton | null; defaultRow: { row: number; col: number }; onDone: () => void;
}) {
  const t = useT("botPostbox");
  const { lang } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: panelsData } = usePanels(botId);

  const [label, setLabel] = useState(button?.label ?? "");
  const [kind, setKind] = useState<PostboxButton["kind"]>(button?.kind ?? "url");
  const [target, setTarget] = useState(button?.target ?? "");
  const [style, setStyle] = useState<PostboxButton["style"]>(button?.style ?? "default");

  const save = useMutation({
    mutationFn: () => {
      const body = { label, kind, target, style, row: button?.row ?? defaultRow.row, col: button?.col ?? defaultRow.col };
      return button
        ? customFetch(`/api/bots/${botId}/postbox/messages/${messageId}/buttons/${button.id}`, {
            method: "PATCH", body: JSON.stringify(body),
          })
        : customFetch(`/api/bots/${botId}/postbox/messages/${messageId}/buttons`, {
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
        <div className="space-y-1">
          <Label htmlFor="pb-btn-label">{t.fieldButtonLabel}</Label>
          <Input id="pb-btn-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t.buttonLabelPlaceholder} />
        </div>

        <div className="space-y-1">
          <Label>{t.fieldButtonKind}</Label>
          <Select value={kind} onValueChange={(v) => { setKind(v as PostboxButton["kind"]); setTarget(""); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="url">{t.kindUrl}</SelectItem>
              <SelectItem value="panel">{t.kindPanel}</SelectItem>
              <SelectItem value="miniapp">{t.kindMiniapp}</SelectItem>
              <SelectItem value="translation">{t.kindTranslation}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>{t.fieldButtonTarget}</Label>
          {kind === "panel" ? (
            <Select value={target || "__none__"} onValueChange={(v) => setTarget(v === "__none__" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder={t.pickPanel} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t.pickPanel}</SelectItem>
                {(panelsData?.panels ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : kind === "translation" ? (
            <Select value={target || "__none__"} onValueChange={(v) => setTarget(v === "__none__" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder={t.pickTranslation} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t.pickTranslation}</SelectItem>
                {translations.map((tr) => (
                  <SelectItem key={tr.id} value={tr.id}>
                    <span dir="ltr">{tr.lang_code}{tr.lang_label ? ` — ${tr.lang_label}` : ""}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              dir="ltr" value={target} onChange={(e) => setTarget(e.target.value)}
              placeholder={kind === "miniapp" ? t.miniappPlaceholder : t.urlPlaceholder}
            />
          )}
          {kind === "translation" && translations.length === 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{t.noTranslationsForButton}</p>
          )}
        </div>

        <div className="space-y-1">
          <Label>{t.fieldButtonStyle}</Label>
          <div className="flex gap-2">
            {(Object.keys(STYLE_SWATCH) as PostboxButton["style"][]).map((s) => (
              <button
                key={s} type="button" onClick={() => setStyle(s)}
                className={`h-8 flex-1 rounded-md text-xs ${STYLE_SWATCH[s]} ${style === s ? "ring-2 ring-offset-2 ring-ring" : ""}`}
              >
                {t[`style_${s}` as keyof typeof t] as string}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t.styleOldClientHint}</p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onDone}>{t.cancel}</Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={!label.trim() || !target.trim() || save.isPending}>
            {save.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {save.isPending ? t.saving : t.save}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function PostboxButtonsTab({
  botId, detail,
}: { botId: string; detail: PostboxMessageDetail }) {
  const t = useT("botPostbox");
  const { toast } = useToast();
  const qc = useQueryClient();
  const { message, buttons, translations } = detail;

  const [editing, setEditing] = useState<PostboxButton | "new-row" | "new-in-row" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PostboxButton | null>(null);

  const rows = useMemo(() => groupByRow(buttons), [buttons]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["bot-postbox-message", botId, message.id] });

  const patchButton = useMutation({
    mutationFn: (vars: { id: string; row: number; col: number }) =>
      customFetch(`/api/bots/${botId}/postbox/messages/${message.id}/buttons/${vars.id}`, {
        method: "PATCH", body: JSON.stringify({ row: vars.row, col: vars.col }),
      }),
    onSuccess: invalidate,
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/bots/${botId}/postbox/messages/${message.id}/buttons/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); setDeleteTarget(null); },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const hasSentTargets = detail.targets.some((tg) => tg.status === "sent");
  const syncButtons = useMutation({
    mutationFn: () => customFetch(`/api/bots/${botId}/postbox/messages/${message.id}/edit-buttons`, { method: "POST" }),
    onSuccess: () => toast({ title: t.syncButtonsQueued }),
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  function swapRows(rowIndex: number, otherIndex: number) {
    const a = rows[rowIndex];
    const b = rows[otherIndex];
    if (!a || !b) return;
    const rowA = a[0].row;
    const rowB = b[0].row;
    Promise.all([
      ...a.map((btn) => patchButton.mutateAsync({ id: btn.id, row: rowB, col: btn.col })),
      ...b.map((btn) => patchButton.mutateAsync({ id: btn.id, row: rowA, col: btn.col })),
    ]);
  }

  function swapCols(rowIndex: number, colIndex: number, otherColIndex: number) {
    const row = rows[rowIndex];
    const a = row?.[colIndex];
    const b = row?.[otherColIndex];
    if (!a || !b) return;
    Promise.all([
      patchButton.mutateAsync({ id: a.id, row: a.row, col: b.col }),
      patchButton.mutateAsync({ id: b.id, row: b.row, col: a.col }),
    ]);
  }

  if (editing && editing !== "new-row" && editing !== "new-in-row") {
    return (
      <ButtonForm
        botId={botId} messageId={message.id} translations={translations} button={editing}
        defaultRow={{ row: editing.row, col: editing.col }} onDone={() => setEditing(null)}
      />
    );
  }
  if (editing === "new-row" || editing === "new-in-row") {
    const maxRow = rows.length > 0 ? Math.max(...rows.map((r) => r[0].row)) : -1;
    const lastRow = rows[rows.length - 1];
    const defaultRow = editing === "new-row"
      ? { row: maxRow + 1, col: 0 }
      : { row: lastRow ? lastRow[0].row : 0, col: lastRow ? Math.max(...lastRow.map((b) => b.col)) + 1 : 0 };
    return (
      <ButtonForm
        botId={botId} messageId={message.id} translations={translations} button={null}
        defaultRow={defaultRow} onDone={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <TelegramPreview rows={rows} botId={botId} />

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{t.noButtonsYet}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, rowIndex) => (
            <div key={row[0].row} className="space-y-1 rounded-md border p-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t.rowLabel} {rowIndex + 1}</span>
                <div className="flex gap-0.5">
                  <Button
                    variant="ghost" size="icon" className="size-6" aria-label={t.moveRowUp}
                    disabled={rowIndex === 0} onClick={() => swapRows(rowIndex, rowIndex - 1)}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="size-6" aria-label={t.moveRowDown}
                    disabled={rowIndex === rows.length - 1} onClick={() => swapRows(rowIndex, rowIndex + 1)}
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {row.map((btn, colIndex) => (
                  <div key={btn.id} className="flex items-center gap-0.5 rounded-md border p-1">
                    <span className={`rounded px-2 py-0.5 text-xs ${STYLE_SWATCH[btn.style]}`}>{btn.label}</span>
                    <Button
                      variant="ghost" size="icon" className="size-6" aria-label={t.moveButtonLeft}
                      disabled={colIndex === 0} onClick={() => swapCols(rowIndex, colIndex, colIndex - 1)}
                    >
                      <ArrowLeft className="size-3 rtl-flip" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="size-6" aria-label={t.moveButtonRight}
                      disabled={colIndex === row.length - 1} onClick={() => swapCols(rowIndex, colIndex, colIndex + 1)}
                    >
                      <ArrowRight className="size-3 rtl-flip" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-6" aria-label={t.editTranslation} onClick={() => setEditing(btn)}>
                      <Pencil className="size-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-6" aria-label={t.deleteMessage} onClick={() => setDeleteTarget(btn)}>
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => setEditing("new-in-row")} disabled={rows.length === 0}>
          <Plus className="me-2 size-4" /> {t.addButtonToRow}
        </Button>
        <Button variant="outline" className="flex-1" onClick={() => setEditing("new-row")}>
          <Rows3 className="me-2 size-4" /> {t.addNewRow}
        </Button>
      </div>

      {hasSentTargets && (
        <Button variant="ghost" className="w-full" size="sm" onClick={() => syncButtons.mutate()} disabled={syncButtons.isPending}>
          {syncButtons.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <RefreshCw className="me-2 size-4" />}
          {t.syncButtons}
        </Button>
      )}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deleteButtonConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.deleteButtonConfirmDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && remove.mutate(deleteTarget.id)} disabled={remove.isPending}>
              {remove.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.confirmDelete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
