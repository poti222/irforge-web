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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
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

/**
 * انتخابگر مقصد — **دو مرحله‌ای**.
 *
 * قبلاً همه‌چیز در یک دراپ‌داون بود: چهار اکشن داخلی، همه‌ی پنل‌ها، همه‌ی فرم‌ها
 * و یک گزینه‌ی URL، پشت‌سرهم. روی باتی با ۲۰ پنل، پیدا کردن «فرم ثبت‌نام» یعنی
 * اسکرول در فهرستی که سه نوع چیزِ کاملاً متفاوت را قاطی کرده بود.
 *
 * حالا اول **نوع** انتخاب می‌شود و بعد فقط انتخابگر همان نوع نشان داده می‌شود.
 */
type TargetKind = "builtin" | "panel" | "form" | "url";

/**
 * ورودی کاربر را به یک URL قابل قبول تبدیل می‌کند.
 *
 * سه چیزی که در عمل باعث رد شدن می‌شدند:
 *  - **فاصله.** فیلد از قبل با `https://` پر می‌شد و کاربر بعدش تایپ می‌کرد؛
 *    کیبورد موبایل یک فاصله می‌گذاشت و نتیجه `https:// example.com` می‌شد که
 *    اعتبارسنجی ردش می‌کرد، با پیامی که نمی‌گفت مشکل کجاست.
 *  - **دامنه‌ی خالی.** کاربر `example.com` می‌نوشت و انتظار داشت کار کند.
 *  - **`http://`** که تلگرام و سرور هر دو رد می‌کنند.
 *
 * پس همه‌ی فاصله‌ها حذف، دامنه‌ی بدون پروتکل با `https://` کامل، و `http://`
 * به `https://` ارتقا داده می‌شود.
 */
export function normalizeUrl(raw: string): string {
  const compact = raw.replace(/\s+/g, "");
  if (!compact) return "";
  if (/^https:\/\//i.test(compact)) return compact;
  if (/^http:\/\//i.test(compact)) return compact.replace(/^http:\/\//i, "https://");
  return `https://${compact.replace(/^\/+/, "")}`;
}

function kindOf(target: string): TargetKind | "" {
  if (!target) return "";
  if (target.startsWith("panel:")) return "panel";
  if (target.startsWith("form:")) return "form";
  if (target.startsWith("url:")) return "url";
  return "builtin";
}

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
  // نوع از روی مقدار فعلی استنتاج می‌شود تا حالت تکراری نگه نداریم؛ ولی وقتی
  // کاربر نوع را عوض می‌کند و هنوز چیزی انتخاب نکرده، مقدار خالی است و
  // استنتاج جواب نمی‌دهد — پس همان یک حالت جدا نگه داشته می‌شود.
  const [pendingKind, setPendingKind] = useState<TargetKind | "">("");
  const kind = kindOf(value) || pendingKind;

  function pickKind(next: TargetKind) {
    setPendingKind(next);
    // عوض‌کردن نوع، مقدار قبلی را بی‌معنا می‌کند — نگه‌داشتنش یعنی ذخیره‌ی یک
    // `panel:<id>` وقتی کاربر «فرم» را انتخاب کرده.
    // عمداً بدون پیش‌پرکردنِ `https://`: همان پیش‌پرکردن بود که کاربر را
    // وامی‌داشت بعد از آن تایپ کند و یک فاصله وسطش بگذارد.
    onChange("");
  }

  return (
    <div className="space-y-2">
      <Select value={kind || undefined} onValueChange={(v) => pickKind(v as TargetKind)}>
        <SelectTrigger><SelectValue placeholder={t.pickTargetKind} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="builtin">{t.targetGroupBuiltin}</SelectItem>
          <SelectItem value="panel">{t.targetGroupPanels}</SelectItem>
          <SelectItem value="form">{t.targetGroupForms}</SelectItem>
          <SelectItem value="url">{t.targetUrl}</SelectItem>
        </SelectContent>
      </Select>

      {kind === "builtin" && (
        <Select value={value || undefined} onValueChange={onChange}>
          <SelectTrigger><SelectValue placeholder={t.pickBuiltin} /></SelectTrigger>
          <SelectContent>
            {targets?.builtin.map((b) => (
              <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {kind === "panel" && (
        (targets?.panels.length ?? 0) === 0 ? (
          <p className="text-xs text-muted-foreground">{t.noPanelsYet}</p>
        ) : (
          <Select value={value || undefined} onValueChange={onChange}>
            <SelectTrigger><SelectValue placeholder={t.pickPanel} /></SelectTrigger>
            <SelectContent>
              {targets!.panels.map((p) => (
                <SelectItem key={p.id} value={`panel:${p.id}`}>{p.title || p.id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      )}

      {kind === "form" && (
        (targets?.forms.length ?? 0) === 0 ? (
          <p className="text-xs text-muted-foreground">{t.noFormsYet}</p>
        ) : (
          <Select value={value || undefined} onValueChange={onChange}>
            <SelectTrigger><SelectValue placeholder={t.pickForm} /></SelectTrigger>
            <SelectContent>
              {targets!.forms.map((f) => (
                <SelectItem key={f.id} value={`form:${f.id}`}>{f.title || f.id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      )}

      {kind === "url" && (
        <>
          <Input
            dir="ltr"
            placeholder="example.com"
            value={value.startsWith("url:") ? value.slice(4) : ""}
            // نرمال‌سازی هنگام خروج از فیلد، نه هر کیبورد-استروک: وگرنه اولین
            // حرفی که کاربر تایپ می‌کند بلافاصله به `https://a` تبدیل می‌شود
            // و ادامه‌ی تایپ را به‌هم می‌ریزد.
            onChange={(e) => onChange(`url:${e.target.value}`)}
            onBlur={(e) => onChange(`url:${normalizeUrl(e.target.value)}`)}
            aria-invalid={
              value.slice(4).trim() !== "" && !/^https:\/\/\S+$/i.test(normalizeUrl(value.slice(4)))
                ? true
                : undefined
            }
          />
          <p className="text-xs text-muted-foreground">{t.urlHint}</p>
        </>
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
    queryFn: () => customFetch<{ commands: BotCommand[]; count: number; menu: string[] }>(`/api/bots/${botId}/commands`),
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
  /**
   * افزودن/برداشتن از منوی «/» تلگرام. جدا از `update` است چون سرور علاوه بر
   * نوشتن روی شیت، همان لحظه `setMyCommands` را هم صدا می‌زند و ممکن است
   * تلگرام ردش کند — آن خطا باید جدا از خطای ذخیره‌ی خود کامند دیده شود.
   */
  const setMenu = useMutation({
    mutationFn: ({ command, inMenu }: { command: string; inMenu: boolean }) =>
      customFetch<{ menu: string[] }>(`/api/bots/${botId}/commands/${command}/menu`, {
        method: "PUT",
        body: JSON.stringify({ inMenu }),
      }),
    onSuccess: (_result, variables) => {
      invalidate();
      toast({ title: variables.inMenu ? t.menuAdded : t.menuRemoved });
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: t.menuFailed, description: errMessage(err, t.errorGeneric) }),
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
  const menu = data.menu ?? [];

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
        <p className="w-full text-sm text-muted-foreground sm:w-auto sm:min-w-0 sm:flex-1">{t.sectionDesc}</p>
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
                <th className="p-2 text-start font-medium">{t.colInMenu}</th>
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
                  <td className="p-2">
                    {/* منوی «/» تلگرام — همان چیزی که کاربر کنار کادر پیام
                        می‌بیند. مستقل از `is_active` است: یک کامند می‌تواند کار
                        کند ولی عمداً در منو نباشد. */}
                    <Switch
                      checked={menu.includes(cmd.command)}
                      aria-label={t.colInMenu}
                      disabled={setMenu.isPending}
                      onCheckedChange={(v) => setMenu.mutate({ command: cmd.command, inMenu: v })}
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
                create.mutate(
                  {
                    ...draft,
                    target: draft.target?.startsWith("url:")
                      ? `url:${normalizeUrl(draft.target.slice(4))}`
                      : draft.target,
                  },
                  {
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
