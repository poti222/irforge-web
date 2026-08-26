/**
 * WalletSection.tsx — IRFORGE_PROMPT_V3 Phase 24
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin UI for the bot's per-owner `wallet` plugin: look up a Telegram
 * user's wallet, credit/debit/freeze/unfreeze it, charge or refund an order,
 * and edit the notification templates — all previously Telegram-command-only
 * (see `api-server/src/lib/walletStore.ts`'s header for the full rationale
 * and the cross-process locking this relies on for correctness).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import {
  Wallet, Loader2, Search, Snowflake, Sun, Plus, Minus, ReceiptText, Bell,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";

type WalletRecord = { id: string; owner_type: string; owner_id: string; currency: string; balance: number; status: string };
type LedgerEntry = { id: string; action: string; amount_before: number; amount_changed: number; amount_after: number; reason: string; at: string };
type UserSummary = { user_id: string; username: string; first_name: string; last_name: string };
type WalletTemplates = { credit: string; debit: string; freeze: string; unfreeze: string; admin_log: string };
type NotifySettings = { user_notify_enabled: boolean; admin_notify_enabled: boolean; log_targets: string[]; templates: WalletTemplates };

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}
function displayName(u: UserSummary): string {
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return name || (u.username ? `@${u.username}` : u.user_id);
}
function fmt(n: number): string {
  return n.toLocaleString("fa-IR");
}

// ─── کیف‌پول یک کاربر ────────────────────────────────────────────────────────

function AmountAction({
  botId, userId, action, icon, label, onDone,
}: { botId: string; userId: string; action: "credit" | "debit"; icon: React.ReactNode; label: string; onDone: () => void }) {
  const t = useT("botWallet");
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const run = useMutation({
    mutationFn: () => customFetch<{ notified: string; notifyError: string | null }>(
      `/api/bots/${botId}/wallet/users/${userId}/${action}`,
      { method: "POST", body: JSON.stringify({ amount: Number(amount), reason }) },
    ),
    onSuccess: (res) => {
      toast({ title: label, description: res.notified === "sent" ? t.userNotified : res.notified === "failed" ? `${t.notifyFailed}: ${res.notifyError}` : undefined });
      setOpen(false); setAmount(""); setReason("");
      onDone();
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  if (!open) {
    return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>{icon}{label}</Button>;
  }
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border p-2">
      <div className="space-y-1">
        <Label className="text-xs">{t.fieldAmount}</Label>
        <AmountInput className="w-32" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t.fieldReason}</Label>
        <Input className="w-48" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.reasonPlaceholder} />
      </div>
      <Button size="sm" onClick={() => run.mutate()} disabled={!amount || Number(amount) <= 0 || run.isPending}>
        {run.isPending && <Loader2 className="me-1.5 size-3.5 animate-spin" />}
        {t.confirm}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{t.cancel}</Button>
    </div>
  );
}

function WalletDetail({ botId, userId }: { botId: string; userId: string }) {
  const t = useT("botWallet");
  const { toast } = useToast();
  const qc = useQueryClient();

  const walletKey = ["bot-wallet", botId, userId] as const;
  const { data, isLoading, error } = useQuery({
    queryKey: walletKey,
    queryFn: () => customFetch<{ wallet: WalletRecord; transactions: LedgerEntry[] }>(`/api/bots/${botId}/wallet/users/${userId}`),
  });

  const toggleFreeze = useMutation({
    mutationFn: (freeze: boolean) =>
      customFetch<{ notified: string; notifyError: string | null }>(
        `/api/bots/${botId}/wallet/users/${userId}/${freeze ? "freeze" : "unfreeze"}`,
        { method: "POST", body: JSON.stringify({}) },
      ),
    onSuccess: () => { qc.invalidateQueries({ queryKey: walletKey }); },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  if (isLoading) return <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;
  if (error) return <p className="p-4 text-sm text-destructive">{errMessage(error, t.errorGeneric)}</p>;
  if (!data) return null;

  const { wallet, transactions } = data;
  const frozen = wallet.status === "frozen";

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p dir="ltr" className="text-xs text-muted-foreground">{wallet.owner_id}</p>
            <p className="text-2xl font-bold">{fmt(wallet.balance)} <span className="text-sm font-normal text-muted-foreground">{wallet.currency}</span></p>
          </div>
          <Badge variant={frozen ? "destructive" : "outline"}>
            {frozen ? <Snowflake className="me-1 size-3" /> : <Sun className="me-1 size-3" />}
            {frozen ? t.statusFrozen : t.statusActive}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-2">
          <AmountAction botId={botId} userId={userId} action="credit" icon={<Plus className="me-1.5 size-4" />} label={t.credit} onDone={() => qc.invalidateQueries({ queryKey: walletKey })} />
          <AmountAction botId={botId} userId={userId} action="debit" icon={<Minus className="me-1.5 size-4" />} label={t.debit} onDone={() => qc.invalidateQueries({ queryKey: walletKey })} />
          <Button size="sm" variant={frozen ? "default" : "outline"} onClick={() => toggleFreeze.mutate(!frozen)} disabled={toggleFreeze.isPending}>
            {toggleFreeze.isPending && <Loader2 className="me-1.5 size-3.5 animate-spin" />}
            {frozen ? t.unfreeze : t.freeze}
          </Button>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">{t.recentTransactions}</p>
          {transactions.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t.noTransactionsYet}</p>
          ) : (
            <div className="space-y-1.5">
              {transactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 p-2 text-xs">
                  <div className="min-w-0">
                    <p className="truncate">{tx.action} — {tx.reason || "-"}</p>
                    <p dir="ltr" className="text-muted-foreground">{tx.at?.slice(0, 16)}</p>
                  </div>
                  <span dir="ltr" className={tx.amount_changed > 0 ? "text-emerald-600" : tx.amount_changed < 0 ? "text-destructive" : "text-muted-foreground"}>
                    {tx.amount_changed > 0 ? "+" : ""}{fmt(tx.amount_changed)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function UserLookupTab({ botId }: { botId: string }) {
  const t = useT("botWallet");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<UserSummary | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ["bot-wallet-user-search", botId, query],
    queryFn: () => customFetch<{ users: UserSummary[] }>(`/api/bots/${botId}/bot-users?search=${encodeURIComponent(query)}&limit=8`),
    enabled: query.trim().length >= 2,
  });

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="ps-8" value={query} placeholder={t.searchUsersPlaceholder}
          onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
        />
      </div>

      {isFetching && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>}

      {!selected && (data?.users?.length ?? 0) > 0 && (
        <div className="space-y-1">
          {data!.users.map((u) => (
            <button
              key={u.user_id} type="button" onClick={() => setSelected(u)}
              className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-start text-sm hover:bg-muted"
            >
              <span>{displayName(u)}</span>
              <span dir="ltr" className="text-xs text-muted-foreground">{u.user_id}</span>
            </button>
          ))}
        </div>
      )}

      {!selected && query.trim().length >= 2 && !isFetching && (data?.users?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground">{t.noUsersFound}</p>
      )}

      {selected && (
        <div className="space-y-2">
          <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>{t.backToSearch}</Button>
          <WalletDetail botId={botId} userId={selected.user_id} />
        </div>
      )}
    </div>
  );
}

// ─── شارژ/بازگشتِ وجه یک سفارش ───────────────────────────────────────────────

function OrderTab({ botId }: { botId: string }) {
  const t = useT("botWallet");
  const { toast } = useToast();
  const [orderCode, setOrderCode] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const run = useMutation({
    mutationFn: (kind: "charge" | "refund") =>
      customFetch<{ wallet: WalletRecord; notified: string; notifyError: string | null }>(
        `/api/bots/${botId}/wallet/${kind}-order`,
        { method: "POST", body: JSON.stringify({ orderCode, amount: Number(amount), reason }) },
      ),
    onSuccess: (res) => {
      toast({ title: t.orderActionDone, description: `${t.newBalance}: ${fmt(res.wallet.balance)}` });
      setOrderCode(""); setAmount(""); setReason("");
    },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const valid = orderCode.trim().length > 0 && Number(amount) > 0;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="text-xs text-muted-foreground">{t.orderTabDesc}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>{t.fieldOrderCode}</Label>
            <Input dir="ltr" value={orderCode} onChange={(e) => setOrderCode(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t.fieldAmount}</Label>
            <AmountInput value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t.fieldReason}</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.reasonPlaceholder} />
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => run.mutate("charge")} disabled={!valid || run.isPending}>
            {run.isPending && <Loader2 className="me-1.5 size-3.5 animate-spin" />}
            <ReceiptText className="me-1.5 size-4" /> {t.chargeOrder}
          </Button>
          <Button size="sm" variant="outline" onClick={() => run.mutate("refund")} disabled={!valid || run.isPending}>
            <ReceiptText className="me-1.5 size-4" /> {t.refundOrder}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── تنظیمات اعلان ────────────────────────────────────────────────────────────

const TEMPLATE_KEYS: (keyof WalletTemplates)[] = ["credit", "debit", "freeze", "unfreeze", "admin_log"];

function NotifySettingsTab({ botId }: { botId: string }) {
  const t = useT("botWallet");
  const { toast } = useToast();
  const qc = useQueryClient();

  const settingsKey = ["bot-wallet-notify-settings", botId] as const;
  const { data, isLoading } = useQuery({
    queryKey: settingsKey,
    queryFn: () => customFetch<NotifySettings>(`/api/bots/${botId}/wallet-notify-settings`),
  });

  const [draft, setDraft] = useState<NotifySettings | null>(null);
  const settings = draft ?? data ?? null;

  const save = useMutation({
    mutationFn: (next: NotifySettings) => customFetch<NotifySettings>(`/api/bots/${botId}/wallet-notify-settings`, { method: "PUT", body: JSON.stringify(next) }),
    onSuccess: (res) => { qc.setQueryData(settingsKey, res); setDraft(null); toast({ title: t.settingsSaved }); },
    onError: (err: any) => toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  if (isLoading || !settings) return <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;

  function update(patch: Partial<NotifySettings>) {
    setDraft({ ...settings!, ...patch });
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <p className="text-xs text-muted-foreground">{t.notifySettingsDesc}</p>

        <div className="flex items-center justify-between gap-2 rounded-md border p-2">
          <Label className="text-sm">{t.userNotifyEnabled}</Label>
          <Switch checked={settings.user_notify_enabled} onCheckedChange={(v) => update({ user_notify_enabled: v })} />
        </div>
        <div className="flex items-center justify-between gap-2 rounded-md border p-2">
          <Label className="text-sm">{t.adminNotifyEnabled}</Label>
          <Switch checked={settings.admin_notify_enabled} onCheckedChange={(v) => update({ admin_notify_enabled: v })} />
        </div>

        <div className="space-y-1">
          <Label>{t.logTargets}</Label>
          <Textarea
            dir="ltr" rows={2} value={settings.log_targets.join("\n")}
            placeholder={t.logTargetsPlaceholder}
            onChange={(e) => update({ log_targets: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
          />
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium">{t.templatesTitle}</p>
          <p className="text-xs text-muted-foreground">{t.templatesDesc}</p>
          {TEMPLATE_KEYS.map((key) => (
            <div key={key} className="space-y-1">
              <Label className="text-xs">{(t as Record<string, string>)[`template_${key}`] ?? key}</Label>
              <Textarea
                rows={key === "admin_log" ? 4 : 3}
                value={settings.templates[key]}
                onChange={(e) => update({ templates: { ...settings.templates, [key]: e.target.value } })}
              />
            </div>
          ))}
        </div>

        <Button onClick={() => save.mutate(settings)} disabled={save.isPending}>
          {save.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
          {t.save}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── ورودی سکشن ──────────────────────────────────────────────────────────────

export function WalletSection({ bot }: { bot: Bot }) {
  const t = useT("botWallet");
  const qc = useQueryClient();

  const probeKey = ["bot-wallet-notify-settings", bot.id] as const;
  const { isLoading, error } = useQuery({
    queryKey: probeKey,
    queryFn: () => customFetch<NotifySettings>(`/api/bots/${bot.id}/wallet-notify-settings`),
  });

  const activate = useMutation({
    mutationFn: () => customFetch(`/api/bots/${bot.id}/plugins/wallet`, { method: "PATCH", body: JSON.stringify({ enabled: true }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bot-plugins", bot.id] }); qc.invalidateQueries({ queryKey: probeKey }); },
  });

  if (isLoading) return <div className="flex items-center gap-2 p-8 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;

  if (errCode(error) === "plugin_disabled") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <Wallet className="size-8 text-muted-foreground" />
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

  if (error) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {errCode(error) === "no_sheet" ? t.noSheetYet : errMessage(error, t.errorGeneric)}
      </div>
    );
  }

  return (
    <Tabs defaultValue="user" className="space-y-4">
      <TabsList>
        <TabsTrigger value="user"><Wallet className="me-1.5 size-4" /> {t.tabUser}</TabsTrigger>
        <TabsTrigger value="order"><ReceiptText className="me-1.5 size-4" /> {t.tabOrder}</TabsTrigger>
        <TabsTrigger value="notify"><Bell className="me-1.5 size-4" /> {t.tabNotify}</TabsTrigger>
      </TabsList>
      <TabsContent value="user"><UserLookupTab botId={bot.id} /></TabsContent>
      <TabsContent value="order"><OrderTab botId={bot.id} /></TabsContent>
      <TabsContent value="notify"><NotifySettingsTab botId={bot.id} /></TabsContent>
    </Tabs>
  );
}
