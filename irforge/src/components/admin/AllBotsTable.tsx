import { useState } from "react";
import { customFetch, useAdminListUsers, getAdminListUsersQueryKey } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ExternalLink, Bot as BotIcon, Plus, Loader2, Trash2, Check, ChevronsUpDown, KeyRound,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";

type AdminBot = Bot & { owner: { id: string; name: string; email: string } | null };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  inactive: "secondary",
  pending_payment: "outline",
  payment_rejected: "destructive",
  error: "destructive",
};

// Exported so the admin panel's header RefreshButton (Phase 13) can watch/
// invalidate this tab's data without duplicating the key.
export const ADMIN_BOTS_KEY = ["admin-bots"];

export function AllBotsTable() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const tt = useT("botTiers");
  const nf = (n: number | undefined) => (n ?? 0).toLocaleString(fa ? "fa-IR" : "en-US");

  const { data: bots, isLoading } = useQuery({
    queryKey: ADMIN_BOTS_KEY,
    queryFn: () => customFetch<AdminBot[]>("/api/admin/bots"),
  });

  // ─── Add bot dialog ─────────────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // `queryKey` صریح داده می‌شود چون تایپ تولیدشده‌ی orval آن را اجباری کرده
  // (`UseQueryOptions` کامل، نه `Omit<..., "queryKey">`). همان کلید پیش‌فرضِ
  // خودِ هوک است، پس رفتار عوض نمی‌شود — فقط typecheck سبز می‌شود.
  const { data: users } = useAdminListUsers({
    query: { enabled: open, queryKey: getAdminListUsersQueryKey() },
  });
  const selectedOwner = users?.find((u) => u.id === ownerId) ?? null;

  function resetForm() {
    setName(""); setToken(""); setDescription(""); setOwnerId(null);
  }

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ADMIN_BOTS_KEY });
  }

  async function createBot() {
    if (!name.trim() || !token.trim() || !ownerId) return;
    setCreating(true);
    try {
      const created = await customFetch<AdminBot & { sheetAssigned?: boolean }>("/api/admin/bots", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          token: token.trim(),
          ownerId,
          description: description.trim() || undefined,
        }),
      });
      await invalidate();
      setOpen(false);
      resetForm();
      toast({
        title: fa ? "بات اضافه شد" : "Bot added",
        description: created.sheetAssigned
          ? (fa ? "یک شیت آزاد از pool بهش اختصاص داده شد." : "A free sheet from the pool was assigned to it.")
          : (fa ? "هیچ شیت آزادی توی pool نبود؛ بعداً اضافه کن." : "No free sheet was available in the pool; add one later."),
      });
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: fa ? "خطا" : "Error",
        description: e?.status === 409
          ? (fa ? "باتی با این توکن قبلاً ثبت شده." : "A bot with this token is already registered.")
          : e?.message,
      });
    } finally {
      setCreating(false);
    }
  }

  // ─── Registry status check / fix ────────────────────────────────────────
  type RegistryStatus = {
    inRegistry: boolean;
    sheetMatches: boolean;
    nameMatches: boolean;
    poolMatches: boolean;
    synced: boolean;
    botSheetId: string | null;
  };
  const [checkingId, setCheckingId] = useState<string | null>(null);

  async function checkAndFixStatus(bot: AdminBot) {
    setCheckingId(bot.id);
    try {
      const status = await customFetch<RegistryStatus>(`/api/admin/bots/${bot.id}/registry-status`);

      if (status.synced) {
        toast({
          title: fa ? "همگام است" : "In sync",
          description: fa
            ? "این بات توی tenants ثبت شده و شیت/نامش با pool یکیه."
            : "This bot is registered in tenants and its sheet/name match.",
        });
        return;
      }

      // Out of sync — resync claims a free pool sheet first if the bot has
      // none at all, then pushes the tenant row either way.
      const result = await customFetch<{ ok: boolean; sheetAssigned: boolean; hasSheet: boolean }>(
        `/api/admin/bots/${bot.id}/resync`,
        { method: "POST" }
      );
      const rechecked = await customFetch<RegistryStatus>(`/api/admin/bots/${bot.id}/registry-status`);

      if (rechecked.synced) {
        const parts: string[] = [];
        if (result.sheetAssigned) parts.push(fa ? "یک شیت آزاد از pool بهش اختصاص داده شد" : "a free sheet from the pool was assigned");
        if (!status.poolMatches && status.botSheetId) parts.push(fa ? "ردیف sheet_pool اصلاح شد" : "its sheet_pool row was corrected");
        parts.push(status.inRegistry
          ? (fa ? "اطلاعاتش توی tenants به‌روزرسانی شد" : "its tenants entry was updated")
          : (fa ? "به tenants اضافه شد" : "it was added to tenants"));
        toast({
          title: fa ? "اصلاح شد" : "Fixed",
          description: parts.join(fa ? " و " : " and ") + (fa ? "." : "."),
        });
      } else if (!result.hasSheet) {
        toast({
          variant: "destructive",
          title: fa ? "شیت آزادی توی pool نیست" : "No free sheet in the pool",
          description: fa
            ? "این بات هنوز شیت نداره چون pool خالیه. یک شیت به pool اضافه کن و دوباره امتحان کن."
            : "This bot still has no sheet because the pool is empty. Add a sheet to the pool and try again.",
        });
      } else {
        toast({
          variant: "destructive",
          title: fa ? "هنوز همگام نیست" : "Still out of sync",
          description: fa
            ? "بعد از تلاش برای اصلاح، هنوز مشکل داره. یک بار دیگه امتحان کن یا لاگ سرور رو چک کن."
            : "Still out of sync after attempting a fix. Try again or check server logs.",
        });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: e?.message });
    } finally {
      setCheckingId(null);
    }
  }

  // ─── Change tier ────────────────────────────────────────────────────────
  // سوپرادمین می‌تواند پکیجِ ثبت‌شده‌ی یک بات را عوض کند — مثلاً وقتی کاربر
  // آفلاین ارتقا خریده یا موقعِ خرید اشتباه ثبت شده. فقط برچسبِ نمایشی/
  // گزارشیِ `bots.tier` عوض می‌شود (`routes/bots.ts`)، نه رم/CPU واقعیِ هاست.
  const [changingTierId, setChangingTierId] = useState<string | null>(null);

  async function changeTier(bot: AdminBot, tier: string) {
    setChangingTierId(bot.id);
    try {
      await customFetch(`/api/admin/bots/${bot.id}/tier`, {
        method: "PATCH",
        body: JSON.stringify({ tier }),
      });
      await invalidate();
      toast({ title: fa ? "پکیج تغییر کرد" : "Tier changed" });
    } catch (e: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: e?.data?.error ?? e?.message });
    } finally {
      setChangingTierId(null);
    }
  }

  // ─── Delete bot ─────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<AdminBot | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await customFetch(`/api/admin/bots/${deleteTarget.id}`, { method: "DELETE" });
      await invalidate();
      toast({ title: fa ? "بات حذف شد" : "Bot removed" });
      setDeleteTarget(null);
    } catch (e: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: e?.message });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)} data-testid="add-bot-button">
          <Plus className="me-1.5 h-4 w-4" />
          {fa ? "افزودن بات با توکن" : "Add bot with token"}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />)}</div>
      ) : !bots || bots.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-12 text-center">
          <BotIcon className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{fa ? "هیچ باتی روی پلتفرم نیست." : "No bots on the platform yet."}</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{fa ? "ربات" : "Bot"}</TableHead>
                <TableHead>{fa ? "مالک" : "Owner"}</TableHead>
                <TableHead>{fa ? "وضعیت" : "Status"}</TableHead>
                <TableHead>{fa ? "پکیج" : "Tier"}</TableHead>
                <TableHead className="hidden md:table-cell">{fa ? "کاربران" : "Users"}</TableHead>
                <TableHead className="hidden md:table-cell">{fa ? "پیام‌ها" : "Messages"}</TableHead>
                <TableHead className="hidden lg:table-cell">{fa ? "تاریخ" : "Created"}</TableHead>
                <TableHead className="text-end">{fa ? "عملیات" : "Actions"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bots.map((bot) => (
                <TableRow key={bot.id}>
                  <TableCell>
                    <div className="font-medium">{bot.name}</div>
                    {bot.username && <div className="text-xs text-muted-foreground">@{bot.username}</div>}
                  </TableCell>
                  <TableCell>
                    {bot.owner ? (
                      <>
                        <div className="text-sm">{bot.owner.name}</div>
                        <div className="text-xs text-muted-foreground">{bot.owner.email}</div>
                      </>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[bot.status] ?? "outline"}>{bot.status}</Badge></TableCell>
                  <TableCell>
                    <Select
                      value={bot.tier ?? "__none__"}
                      onValueChange={(v) => changeTier(bot, v)}
                      disabled={changingTierId === bot.id}
                    >
                      <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">{tt.standard.name}</SelectItem>
                        <SelectItem value="pro">{tt.pro.name}</SelectItem>
                        {!bot.tier && <SelectItem value="__none__" disabled>{fa ? "نامشخص" : "Unknown"}</SelectItem>}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{nf(bot.userCount)}</TableCell>
                  <TableCell className="hidden md:table-cell">{nf(bot.messageCount)}</TableCell>
                  <TableCell className="hidden lg:table-cell text-muted-foreground">
                    {new Date(bot.createdAt).toLocaleDateString(fa ? "fa-IR" : "en-US")}
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-1.5">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/bots/${bot.id}`}>
                          <ExternalLink className="me-1 h-3.5 w-3.5" /> {fa ? "باز کردن" : "Open"}
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={fa ? "بررسی و اصلاح وضعیت" : "Check & fix status"}
                        onClick={() => checkAndFixStatus(bot)}
                        disabled={checkingId === bot.id}
                        data-testid={`check-status-bot-${bot.id}`}
                      >
                        {checkingId === bot.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <ShieldCheck className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(bot)}
                        data-testid={`delete-bot-${bot.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ─── Add bot dialog ────────────────────────────────────────────── */}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              {fa ? "افزودن بات با توکن" : "Add bot with token"}
            </DialogTitle>
            <DialogDescription>
              {fa
                ? "این کار برای ثبت دستی باتی که خارج از فلوی پرداخت عادی ساخته شده استفاده می‌شه. اگر شیت آزادی توی pool باشه خودکار بهش اختصاص داده می‌شه."
                : "Use this to manually register a bot created outside the normal payment flow. A free sheet from the pool is assigned automatically if one is available."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bot-name">{fa ? "نام بات" : "Bot name"}</Label>
              <Input id="bot-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={fa ? "مثلاً: بات فروشگاه" : "e.g. Support Bot"} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bot-token">{fa ? "توکن تلگرام بات" : "Telegram bot token"}</Label>
              <Input
                id="bot-token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                dir="ltr"
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label>{fa ? "مالک بات" : "Bot owner"}</Label>
              <Popover open={ownerPickerOpen} onOpenChange={setOwnerPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={ownerPickerOpen}
                    className="w-full justify-between font-normal"
                  >
                    {selectedOwner
                      ? `${selectedOwner.name} — ${selectedOwner.email}`
                      : (fa ? "یک کاربر انتخاب کن…" : "Select a user…")}
                    <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                  <Command>
                    <CommandInput placeholder={fa ? "جستجوی نام یا ایمیل…" : "Search name or email…"} />
                    <CommandList>
                      <CommandEmpty>{fa ? "کاربری پیدا نشد." : "No user found."}</CommandEmpty>
                      <CommandGroup>
                        {users?.map((u) => (
                          <CommandItem
                            key={u.id}
                            value={`${u.name} ${u.email}`}
                            onSelect={() => { setOwnerId(u.id); setOwnerPickerOpen(false); }}
                          >
                            <Check className={cn("me-2 h-4 w-4", ownerId === u.id ? "opacity-100" : "opacity-0")} />
                            <div className="min-w-0">
                              <div className="truncate text-sm">{u.name}</div>
                              <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bot-desc">{fa ? "توضیحات (اختیاری)" : "Description (optional)"}</Label>
              <Textarea id="bot-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{fa ? "انصراف" : "Cancel"}</Button>
            <Button onClick={createBot} disabled={creating || !name.trim() || !token.trim() || !ownerId} data-testid="confirm-add-bot">
              {creating ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : <Plus className="me-1.5 h-4 w-4" />}
              {fa ? "افزودن بات" : "Add bot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete confirmation ───────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fa ? "حذف بات؟" : "Delete this bot?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {fa
                ? `"${deleteTarget?.name}" و همه‌ی داده‌های مرتبط (دستورات، پلاگین‌ها) برای همیشه حذف می‌شه و شیت اختصاصی‌اش به pool برمی‌گرده. این کار قابل بازگشت نیست.`
                : `"${deleteTarget?.name}" and all related data (commands, plugins) will be permanently deleted, and its sheet will return to the pool. This can't be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
              {fa ? "حذف کن" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
