import { useState } from "react";
import {
  useListCommands,
  useCreateCommand,
  useUpdateCommand,
  useDeleteCommand,
  getListCommandsQueryKey,
  getGetBotQueryKey,
} from "@workspace/api-client-react";
import type {
  BotCommand,
  BotCommandInputPermission,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Loader2, Terminal, Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";

const PERMISSIONS: BotCommandInputPermission[] = ["all", "admin", "owner"];

type FormState = {
  id: string | null;
  name: string;
  description: string;
  permission: BotCommandInputPermission;
  argumentsText: string;
  workflow: string;
  enabled: boolean;
};

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  description: "",
  permission: "all",
  argumentsText: "",
  workflow: "",
  enabled: true,
};

// Split "a, b\nc" → ["a","b","c"] (used for the arguments field).
function parseArgs(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function CommandsEditor({ botId }: { botId: string }) {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: commands, isLoading } = useListCommands(botId);
  const createCmd = useCreateCommand();
  const updateCmd = useUpdateCommand();
  const deleteCmd = useDeleteCommand();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleting, setDeleting] = useState<BotCommand | null>(null);
  const [copied, setCopied] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListCommandsQueryKey(botId) });
    queryClient.invalidateQueries({ queryKey: getGetBotQueryKey(botId) });
  };

  function openCreate() {
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(cmd: BotCommand) {
    setForm({
      id: cmd.id,
      name: cmd.name,
      description: cmd.description,
      permission: cmd.permission,
      argumentsText: (cmd.arguments ?? []).join(", "),
      workflow: cmd.workflow ?? "",
      enabled: cmd.enabled ?? true,
    });
    setDialogOpen(true);
  }

  function handleSave() {
    if (!form.name.trim()) {
      toast({ variant: "destructive", title: fa ? "نام دستور الزامی است" : "Command name is required" });
      return;
    }
    const args = parseArgs(form.argumentsText);
    const onDone = (verb: string) => {
      invalidate();
      setDialogOpen(false);
      toast({ title: verb });
    };
    const onError = (err: any) =>
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });

    if (form.id) {
      updateCmd.mutate(
        {
          botId,
          commandId: form.id,
          data: {
            name: form.name.trim(),
            description: form.description.trim(),
            permission: form.permission,
            arguments: args,
            workflow: form.workflow.trim() || undefined,
            enabled: form.enabled,
          },
        },
        { onSuccess: () => onDone(fa ? "دستور به‌روزرسانی شد" : "Command updated"), onError }
      );
    } else {
      createCmd.mutate(
        {
          botId,
          data: {
            name: form.name.trim(),
            description: form.description.trim(),
            permission: form.permission,
            arguments: args,
            workflow: form.workflow.trim() || undefined,
          },
        },
        { onSuccess: () => onDone(fa ? "دستور ساخته شد" : "Command created"), onError }
      );
    }
  }

  function toggleEnabled(cmd: BotCommand, enabled: boolean) {
    updateCmd.mutate(
      { botId, commandId: cmd.id, data: { enabled } },
      { onSuccess: invalidate }
    );
  }

  function confirmDelete() {
    if (!deleting) return;
    deleteCmd.mutate(
      { botId, commandId: deleting.id },
      {
        onSuccess: () => {
          invalidate();
          setDeleting(null);
          toast({ title: fa ? "دستور حذف شد" : "Command deleted" });
        },
        onError: (err: any) =>
          toast({ variant: "destructive", title: fa ? "خطا در حذف" : "Delete failed", description: err?.message }),
      }
    );
  }

  const saving = createCmd.isPending || updateCmd.isPending;

  // Q5: preview is generated ONLY from the real form fields — never a fabricated
  // code sample. It updates live as the user types.
  const preview = {
    name: form.name.trim() || (fa ? "«بدون نام»" : "«unnamed»"),
    description: form.description.trim() || null,
    permission: form.permission,
    arguments: parseArgs(form.argumentsText),
    workflow: form.workflow.trim() || null,
    enabled: form.enabled,
  };
  const previewText = JSON.stringify(preview, null, 2);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* List / table */}
      <div className="lg:col-span-2 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-semibold">{fa ? "دستورات ربات" : "Bot commands"}</h3>
          <Button size="sm" onClick={openCreate} className="w-full sm:w-auto">
            <Plus className="me-2 h-4 w-4" /> {fa ? "دستور جدید" : "New command"}
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />)}
          </div>
        ) : commands && commands.length > 0 ? (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{fa ? "نام" : "Name"}</TableHead>
                  <TableHead className="hidden md:table-cell">{fa ? "توضیح" : "Description"}</TableHead>
                  <TableHead>{fa ? "دسترسی" : "Permission"}</TableHead>
                  <TableHead>{fa ? "فعال" : "Enabled"}</TableHead>
                  <TableHead className="text-end">{fa ? "عملیات" : "Actions"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commands.map((cmd) => (
                  <TableRow key={cmd.id}>
                    <TableCell className="font-mono font-medium">/{cmd.name}</TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground max-w-[220px] truncate">
                      {cmd.description || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={cmd.permission === "all" ? "secondary" : "default"}>{cmd.permission}</Badge>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={cmd.enabled ?? true}
                        onCheckedChange={(v) => toggleEnabled(cmd, v)}
                        aria-label="toggle enabled"
                      />
                    </TableCell>
                    <TableCell className="text-end">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(cmd)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleting(cmd)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-10 text-center">
            <Terminal className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {fa ? "هنوز دستوری تعریف نشده است." : "No commands defined yet."}
            </p>
            <Button size="sm" variant="outline" onClick={openCreate}>
              <Plus className="me-2 h-4 w-4" /> {fa ? "افزودن اولین دستور" : "Add your first command"}
            </Button>
          </div>
        )}
      </div>

      {/* Q5 live preview panel — derived only from the real command object */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-muted-foreground">
            {fa ? "پیش‌نمایش زنده" : "Live preview"}
          </h3>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              navigator.clipboard?.writeText(previewText);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <pre dir="ltr" className="max-h-[420px] overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
          <code>{previewText}</code>
        </pre>
        <p className="text-xs text-muted-foreground">
          {fa
            ? "این پیش‌نمایش مستقیماً از فیلدهای همین فرم ساخته می‌شود."
            : "This preview is generated directly from the fields in this form."}
        </p>
      </div>

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {form.id ? (fa ? "ویرایش دستور" : "Edit command") : (fa ? "دستور جدید" : "New command")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="cmd-name">{fa ? "نام (بدون /)" : "Name (without /)"}</Label>
              <Input
                id="cmd-name" dir="ltr" className="font-mono"
                placeholder="start"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cmd-desc">{fa ? "توضیح" : "Description"}</Label>
              <Input
                id="cmd-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{fa ? "دسترسی" : "Permission"}</Label>
                <Select
                  value={form.permission}
                  onValueChange={(v) => setForm({ ...form, permission: v as BotCommandInputPermission })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PERMISSIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {form.id && (
                <div className="space-y-1.5">
                  <Label>{fa ? "فعال" : "Enabled"}</Label>
                  <div className="flex h-9 items-center">
                    <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cmd-args">{fa ? "آرگومان‌ها (با کاما جدا کنید)" : "Arguments (comma-separated)"}</Label>
              <Input
                id="cmd-args" dir="ltr"
                placeholder="amount, currency"
                value={form.argumentsText}
                onChange={(e) => setForm({ ...form, argumentsText: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cmd-workflow">{fa ? "ورک‌فلو (اختیاری)" : "Workflow (optional)"}</Label>
              <Textarea
                id="cmd-workflow" rows={2}
                value={form.workflow}
                onChange={(e) => setForm({ ...form, workflow: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              {fa ? "انصراف" : "Cancel"}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {fa ? "ذخیره" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fa ? "حذف دستور؟" : "Delete command?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {fa
                ? `دستور «/${deleting?.name}» برای همیشه حذف می‌شود.`
                : `The command “/${deleting?.name}” will be permanently deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCmd.isPending}>{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              disabled={deleteCmd.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteCmd.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {fa ? "حذف" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
