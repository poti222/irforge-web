/**
 * PanelsSection.tsx — سکشن مستقل «پنل‌ها»: لیست/درخت، جستجو، ساخت، و حذف امن.
 *
 * پنلِ در حال ویرایش از **URL** می‌آید (`?section=panels&panel=<id>`) نه از
 * state سراسری — باگ B4 در بات دقیقاً همین است: `edit_panel_id` در FSM می‌ماند
 * و اگر کاربر جای دیگری «ذخیره» بزند، پنل اشتباهی ذخیره می‌شود.
 */
import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import type { Bot } from "@workspace/api-client-react";
import {
  Plus, Search, ListTree, Table2, Loader2, Trash2, Home, Ban, Lock, Wrench, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { confirmDiscardUnsaved } from "@/lib/unsaved-changes";
import { useBotSettings } from "@/components/bots/settings/api";
import { PanelTree } from "./PanelTree";
import { PanelEditor } from "./PanelEditor";
import { CreatePanelDialog } from "./CreatePanelDialog";
import { panelTypeLabel } from "./labels";
import {
  apiErrorCode, apiErrorMessage, useDeletePanel, usePanelCatalog, usePanelHealth,
  usePanelReferences, usePanels, useRepairPanels,
  type ButtonStrategy, type DeleteStrategy, type Panel,
} from "./api";

type View = "tree" | "table";

/** دیالوگ حذف: اول ارجاعات را نشان می‌دهد، بعد استراتژی می‌پرسد (باگ‌های B6/B7). */
function DeletePanelDialog({
  botId,
  panel,
  open,
  onOpenChange,
  onDeleted,
}: {
  botId: string;
  panel: Panel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const t = useT("botPanels");
  const { toast } = useToast();
  const references = usePanelReferences(botId, open && panel ? panel.id : null);
  const remove = useDeletePanel(botId);
  const [strategy, setStrategy] = useState<DeleteStrategy>("reparent");
  const [buttonStrategy, setButtonStrategy] = useState<ButtonStrategy>("disable");

  const childCount = references.data?.children.length ?? 0;
  const buttonCount = references.data?.buttons.length ?? 0;
  const commandCount = references.data?.commands.length ?? 0;

  function submit() {
    if (!panel) return;
    remove.mutate(
      { panelId: panel.id, strategy, buttonStrategy },
      {
        onSuccess: (report) => {
          toast({
            title: t.panelDeleted,
            description: t.deleteReport
              .replace("{deleted}", String(report.deleted.length))
              .replace("{buttons}", String(report.buttonsChanged)),
          });
          onOpenChange(false);
          onDeleted();
        },
        onError: (err: any) =>
          toast({ variant: "destructive", title: t.errorGeneric, description: apiErrorMessage(err, t.errorGeneric) }),
      }
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5 shrink-0" />
            {t.deleteTitle.replace("{name}", panel?.title || panel?.id || "")}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-start">
              <p>{t.deleteIntro}</p>
              {references.isLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ul className="list-inside list-disc text-sm">
                  <li>{t.deleteChildCount.replace("{n}", String(childCount))}</li>
                  <li>{t.deleteButtonCount.replace("{n}", String(buttonCount))}</li>
                  <li>{t.deleteCommandCount.replace("{n}", String(commandCount))}</li>
                  {references.data?.isHome && <li className="text-amber-600 dark:text-amber-400">{t.deleteIsHome}</li>}
                </ul>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          {childCount > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="del-strategy">{t.deleteStrategyLabel}</Label>
              <Select value={strategy} onValueChange={(v) => setStrategy(v as DeleteStrategy)}>
                <SelectTrigger id="del-strategy"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="reparent">{t.strategyReparent}</SelectItem>
                  <SelectItem value="orphan">{t.strategyOrphan}</SelectItem>
                  <SelectItem value="cascade">{t.strategyCascade}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {buttonCount > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="del-buttons">{t.deleteButtonStrategyLabel}</Label>
              <Select value={buttonStrategy} onValueChange={(v) => setButtonStrategy(v as ButtonStrategy)}>
                <SelectTrigger id="del-buttons"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="disable">{t.buttonStrategyDisable}</SelectItem>
                  <SelectItem value="remove">{t.buttonStrategyRemove}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>{t.cancel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); submit(); }}
            disabled={remove.isPending}
            className="bg-red-600 hover:bg-red-700"
          >
            {remove.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {t.deleteConfirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function PanelsSection({ bot }: { bot: Bot }) {
  const t = useT("botPanels");
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const search = useSearch();

  const { data, isLoading, error } = usePanels(bot.id);
  const { data: catalog } = usePanelCatalog(bot.id);
  const health = usePanelHealth(bot.id);
  const repair = useRepairPanels(bot.id);
  const settings = useBotSettings(bot.id);

  const [view, setView] = useState<View>("tree");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Panel | null>(null);

  const selectedId = new URLSearchParams(search).get("panel");
  const panels = data?.panels ?? [];
  const selected = panels.find((p) => p.id === selectedId) ?? null;

  function openPanel(panelId: string | null) {
    if (!confirmDiscardUnsaved()) return;
    const params = new URLSearchParams(search);
    params.set("section", "panels");
    if (panelId) params.set("panel", panelId);
    else params.delete("panel");
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

  // پنلی که در URL است ولی وجود ندارد (لینک کهنه) → برگرد به لیست، نه صفحه‌ی خالی.
  if (selectedId && !selected) {
    return (
      <div className="space-y-3 rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p>{t.panelGone}</p>
        <Button variant="outline" size="sm" onClick={() => openPanel(null)}>{t.backToList}</Button>
      </div>
    );
  }

  if (selected) {
    return (
      <PanelEditor
        botId={bot.id}
        panel={selected}
        panels={panels}
        catalog={catalog}
        watermark={
          settings.data?.settings.watermark_enabled ? settings.data.settings.watermark : undefined
        }
        onBack={() => openPanel(null)}
        onDeleted={() => openPanel(null)}
      />
    );
  }

  const filtered = panels.filter((p) => {
    if (query && !(p.title ?? "").toLowerCase().includes(query.toLowerCase())) return false;
    if (typeFilter !== "all" && p.type !== typeFilter) return false;
    if (statusFilter === "active" && !p.is_active) return false;
    if (statusFilter === "inactive" && p.is_active) return false;
    if (statusFilter === "home" && !p.is_home) return false;
    return true;
  });

  // درخت روی نتیجه‌ی فیلترشده معنا ندارد (والدها ممکن است فیلتر شده باشند)، پس
  // وقتی فیلتری فعال است خودکار به جدول سوییچ می‌شود.
  const filtering = Boolean(query) || typeFilter !== "all" || statusFilter !== "all";
  const effectiveView: View = filtering ? "table" : view;
  const issues = health.data?.issues ?? [];

  return (
    <div className="space-y-4">
      {issues.length > 0 && (
        <Card className="border-amber-500/40">
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <AlertTriangle className="size-5 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t.healthTitle.replace("{n}", String(issues.length))}</p>
              <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                {issues.slice(0, 4).map((issue, i) => <li key={i}>{issue.detail}</li>)}
                {issues.length > 4 && <li>{t.healthMore.replace("{n}", String(issues.length - 4))}</li>}
              </ul>
            </div>
            {issues.some((i) => i.repairable) && (
              <Button
                variant="outline" size="sm" disabled={repair.isPending}
                onClick={() =>
                  repair.mutate(undefined, {
                    onSuccess: ({ fixed }) =>
                      toast({ title: t.repairDone.replace("{n}", String(fixed)) }),
                  })
                }
              >
                {repair.isPending ? <Loader2 className="me-1.5 size-4 animate-spin" /> : <Wrench className="me-1.5 size-4" />}
                {t.repairCta}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute inset-inline-start-0 top-1/2 ms-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-8"
            placeholder={t.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-auto min-w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.filterAllTypes}</SelectItem>
            {(catalog?.panelTypes ?? []).map((x) => (
              <SelectItem key={x} value={x}>{panelTypeLabel(t, x)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-auto min-w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.filterAllStatuses}</SelectItem>
            <SelectItem value="active">{t.filterActive}</SelectItem>
            <SelectItem value="inactive">{t.filterInactive}</SelectItem>
            <SelectItem value="home">{t.filterHome}</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1">
          <Button
            variant={effectiveView === "tree" ? "secondary" : "ghost"} size="icon"
            aria-label={t.viewTree} disabled={filtering} onClick={() => setView("tree")}
          >
            <ListTree className="size-4" />
          </Button>
          <Button
            variant={effectiveView === "table" ? "secondary" : "ghost"} size="icon"
            aria-label={t.viewTable} onClick={() => setView("table")}
          >
            <Table2 className="size-4" />
          </Button>
        </div>

        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="me-1.5 size-4" /> {t.createPanelCta}
        </Button>
      </div>

      {effectiveView === "tree" ? (
        <PanelTree tree={data.tree} selectedId={selectedId} onSelect={openPanel} />
      ) : filtered.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {panels.length === 0 ? t.noPanels : t.noMatches}
        </p>
      ) : (
        // جدول عریض روی موبایل باید افقی اسکرول شود، نه اینکه صفحه را بشکند.
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="bg-muted/50 text-start">
              <tr>
                <th className="p-2 text-start font-medium">{t.colTitle}</th>
                <th className="p-2 text-start font-medium">{t.colType}</th>
                <th className="p-2 text-start font-medium">{t.colStatus}</th>
                <th className="p-2 text-start font-medium">{t.colButtons}</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-2">
                    <button type="button" className="text-start hover:text-primary hover:underline" onClick={() => openPanel(p.id)}>
                      {p.title || t.untitledPanel}
                    </button>
                  </td>
                  <td className="p-2"><Badge variant="outline">{panelTypeLabel(t, p.type)}</Badge></td>
                  <td className="p-2">
                    <div className="flex items-center gap-1">
                      {p.is_home && <Home className="size-3.5 text-emerald-500" aria-label={t.badgeHome} />}
                      {!p.is_active && <Ban className="size-3.5 text-destructive" aria-label={t.badgeInactive} />}
                      {p.settings?.password && <Lock className="size-3.5 text-amber-500" aria-label={t.badgeLocked} />}
                    </div>
                  </td>
                  <td className="p-2 tabular-nums">{p.buttons?.length ?? 0}</td>
                  <td className="p-2 text-end">
                    <Button variant="ghost" size="icon" aria-label={t.deleteCta} onClick={() => setDeleteTarget(p)}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreatePanelDialog
        botId={bot.id}
        panels={panels}
        catalog={catalog}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(panel) => openPanel(panel.id)}
      />

      <DeletePanelDialog
        botId={bot.id}
        panel={deleteTarget}
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onDeleted={() => setDeleteTarget(null)}
      />
    </div>
  );
}
