/**
 * CommandsEditor.tsx — کامندهای سفارشی بات (بازنویسی‌شده، فاز ۱۲).
 *
 * قبلاً این کامپوننت روی جدول `commands` در Postgres سایت کار می‌کرد و شکلش
 * (`name`, `permission`, `arguments`, `workflow`) هیچ ربطی به چیزی که بات
 * می‌خواند نداشت — باگ B13. حالا مستقیم روی تب `custom_commands` شیت تننت است،
 * با همان فیلدهایی که `handlers/custom_commands.py` می‌فهمد.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  Plus, Loader2, Trash2, Terminal, ArrowLeftRight, AlertTriangle, Check, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";

type BotCommand = {
  command: string;
  target: string;
  description: string;
  admin_only: boolean;
  is_active: boolean;
  created_at: string;
};

type Targets = {
  builtin: Array<{ value: string; label: string }>;
  panels: Array<{ id: string; title: string }>;
  forms: Array<{ id: string; title: string }>;
};

const commandsKey = (botId: string) => ["bot-commands", botId] as const;

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}

/** انتخابگر مقصد — گروه‌بندی‌شده، بدون تایپ دستی uuid. */
function TargetPicker({
  value,
  targets,
  onChange,
}: {
  value: string;
  targets: Targets | undefined;
  onChange: (next: string) => void;
}) {
  const t = useT("botCommands");
  const isUrl = value.startsWith("url:");

  return (
    <div className="space-y-2">
      <Select value={isUrl ? "__url__" : value || "__none__"} onValueChange={(v) => onChange(v === "__url__" ? "url:https://" : v === "__none__" ? "" : v)}>
        <SelectTrigger><SelectValue placeholder={t.pickTarget} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">{t.pickTarget}</SelectItem>
          {(targets?.builtin.length ?? 0) > 0 && (
            <SelectGroup>
              <SelectLabel>{t.targetGroupBuiltin}</SelectLabel>
              {targets!.builtin.map((b) => (
                <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
              ))}
            </SelectGroup>
          )}
          {(targets?.panels.length ?? 0) > 0 && (
            <SelectGroup>
              <SelectLabel>{t.targetGroupPanels}</SelectLabel>
              {targets!.panels.map((p) => (
                <SelectItem key={p.id} value={`panel:${p.id}`}>{p.title || p.id}</SelectItem>
              ))}
            </SelectGroup>
          )}
          {(targets?.forms.length ?? 0) > 0 && (
            <SelectGroup>
              <SelectLabel>{t.targetGroupForms}</SelectLabel>
              {targets!.forms.map((f) => (
                <SelectItem key={f.id} value={`form:${f.id}`}>{f.title || f.id}</SelectItem>
              ))}
            </SelectGroup>
          )}
          <SelectGroup>
            <SelectLabel>{t.targetGroupOther}</SelectLabel>
            <SelectItem value="__url__">{t.targetUrl}</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>

      {isUrl && (
        <Input
          dir="ltr"
          value={value.slice(4)}
          onChange={(e) => onChange(`url:${e.target.value}`)}
          aria-invalid={!/^https:\/\/\S+$/i.test(value.slice(4)) || undefined}
        />
      )}
    </div>
  );
}

export function CommandsEditor({ botId }: { botId: string }) {
  const t = useT("botCommands");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: commandsKey(botId),
    queryFn: () => customFetch<{ commands: BotCommand[]; count: number }>(`/api/bots/${botId}/commands`),
  });
  const { data: targets } = useQuery({
    queryKey: ["bot-command-targets", botId],
    queryFn: () => customFetch<Targets>(`/api/bots/${botId}/commands/targets`),
    staleTime: 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: commandsKey(botId) });

  const create = useMutation({
    mutationFn: (body: Partial<BotCommand>) =>
      customFetch<{ command: BotCommand }>(`/api/bots/${botId}/commands`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ command, patch }: { command: string; patch: Partial<BotCommand> }) =>
      customFetch<{ command: BotCommand }>(`/api/bots/${botId}/commands/${command}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (command: string) =>
      customFetch(`/api/bots/${botId}/commands/${command}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  const migrate = useMutation({
    mutationFn: () =>
      customFetch<{ migrated: number; skipped: number; invalid: string[]; total: number }>(
        `/api/bots/${botId}/commands/migrate`,
        { method: "POST" }
      ),
    onSuccess: (result) => {
      invalidate();
      toast({
        title: t.migrateDone
          .replace("{migrated}", String(result.migrated))
          .replace("{skipped}", String(result.skipped)),
        description: result.invalid.length
          ? t.migrateInvalid.replace("{names}", result.invalid.join("، "))
          : undefined,
      });
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<BotCommand>>({ command: "", target: "", description: "", admin_only: false });
  const [createError, setCreateError] = useState<string | null>(null);

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

  const commands = data.commands;

  function targetLabel(target: string): string {
    if (target.startsWith("panel:")) {
      const panel = targets?.panels.find((p) => p.id === target.slice(6));
      return t.targetPanelLabel.replace("{name}", panel?.title || target.slice(6));
    }
    if (target.startsWith("form:")) {
      const form = targets?.forms.find((f) => f.id === target.slice(5));
      return t.targetFormLabel.replace("{name}", form?.title || target.slice(5));
    }
    if (target.startsWith("url:")) return target.slice(4);
    return targets?.builtin.find((b) => b.value === target)?.label ?? target;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">{t.sectionDesc}</p>
        <Button variant="outline" onClick={() => migrate.mutate()} disabled={migrate.isPending}>
          {migrate.isPending ? <Loader2 className="me-1.5 size-4 animate-spin" /> : <ArrowLeftRight className="me-1.5 size-4" />}
          {t.migrateCta}
        </Button>
        <Button onClick={() => { setDraft({ command: "", target: "", description: "", admin_only: false }); setCreateError(null); setCreateOpen(true); }}>
          <Plus className="me-1.5 size-4" /> {t.createCta}
        </Button>
      </div>

      {commands.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t.noCommands}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[38rem] text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-start font-medium">{t.colCommand}</th>
                <th className="p-2 text-start font-medium">{t.colTarget}</th>
                <th className="p-2 text-start font-medium">{t.colDescription}</th>
                <th className="p-2 text-start font-medium">{t.colAdminOnly}</th>
                <th className="p-2 text-start font-medium">{t.colActive}</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {commands.map((cmd) => (
                <tr key={cmd.command} className="border-t">
                  <td className="p-2">
                    <code dir="ltr" className="flex items-center gap-1 font-mono">
                      <Terminal className="size-3.5 shrink-0 text-muted-foreground" />/{cmd.command}
                    </code>
                  </td>
                  <td className="p-2">
                    <div className="min-w-0 max-w-48 truncate">
                      <Badge variant="outline">{targetLabel(cmd.target)}</Badge>
                    </div>
                  </td>
                  <td className="p-2">
                    <span className="line-clamp-1 text-muted-foreground">{cmd.description || "—"}</span>
                  </td>
                  <td className="p-2">
                    {cmd.admin_only ? <Check className="size-4 text-emerald-500" /> : <X className="size-4 text-muted-foreground" />}
                  </td>
                  <td className="p-2">
                    <Switch
                      checked={cmd.is_active}
                      aria-label={t.colActive}
                      onCheckedChange={(v) =>
                        update.mutate(
                          { command: cmd.command, patch: { is_active: v } },
                          { onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }) }
                        )
                      }
                    />
                  </td>
                  <td className="p-2 text-end">
                    <Button
                      variant="ghost" size="icon" aria-label={t.deleteCta}
                      onClick={() =>
                        remove.mutate(cmd.command, {
                          onSuccess: () => toast({ title: t.commandDeleted }),
                          onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
                        })
                      }
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <span>{t.migrateHint}</span>
      </p>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.createTitle}</DialogTitle>
            <DialogDescription>{t.createDesc}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cmd-name">{t.fieldCommand}</Label>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground" dir="ltr">/</span>
                <Input
                  id="cmd-name"
                  dir="ltr"
                  value={draft.command ?? ""}
                  onChange={(e) => { setDraft((p) => ({ ...p, command: e.target.value.replace(/^\//, "") })); setCreateError(null); }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{t.fieldCommandHint}</p>
            </div>

            <div className="space-y-1.5">
              <Label>{t.fieldTarget}</Label>
              <TargetPicker
                value={draft.target ?? ""}
                targets={targets}
                onChange={(target) => { setDraft((p) => ({ ...p, target })); setCreateError(null); }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cmd-desc">{t.fieldDescription}</Label>
              <Textarea
                id="cmd-desc" rows={2}
                value={draft.description ?? ""}
                onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0">
                <Label htmlFor="cmd-admin">{t.fieldAdminOnly}</Label>
                <p className="text-xs text-muted-foreground">{t.fieldAdminOnlyHint}</p>
              </div>
              <Switch
                id="cmd-admin"
                checked={Boolean(draft.admin_only)}
                onCheckedChange={(v) => setDraft((p) => ({ ...p, admin_only: v }))}
              />
            </div>

            {createError && <p className="text-sm text-destructive">{createError}</p>}
          </div>

          <DialogFooter>
            <Button
              disabled={create.isPending}
              onClick={() =>
                create.mutate(draft, {
                  onSuccess: () => {
                    toast({ title: t.commandCreated });
                    setCreateOpen(false);
                  },
                  onError: (err: any) => setCreateError(errMessage(err, t.errorGeneric)),
                })
              }
            >
              {create.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.createCta}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
