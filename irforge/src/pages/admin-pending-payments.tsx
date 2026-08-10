import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import {
  ClipboardList,
  CheckCircle2,
  XCircle,
  ExternalLink,
  User as UserIcon,
  Bot as BotIcon,
  Loader2,
  Inbox,
  Ban,
  AlertTriangle,
  Wallet as WalletIcon,
  ShieldAlert,
  ServerCrash,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ReceiptLightbox } from "@/components/ui/receipt-lightbox";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";
import { formatToman } from "@/lib/format";

type PendingItem = {
  payment: { id: string; botId: string | null; receiptUrl: string | null; description: string | null; status: string; createdAt: string };
  bot: { id: string; name: string; username: string; status: string } | null;
  user: { id: string; name: string; email: string; telegramId: string | null } | null;
};

type WalletDeposit = {
  id: string; type: string; amount: number; status: string;
  receiptUrl: string | null; txHash: string | null; createdAt: string;
  user: { id: string; name: string; email: string } | null;
};

const WALLET_KEY = ["wallet-deposits"] as const;

/**
 * A failed query can mean three very different things, and collapsing all of
 * them into one "super-admin access required" message is actively
 * misleading when the real cause is e.g. a 500 from the DB. Distinguish
 * 401/403 (genuine access problem) from everything else (couldn't load).
 */
function classifyError(err: any): "access" | "server" {
  const status = err?.status;
  return status === 401 || status === 403 ? "access" : "server";
}

function ErrorState({ kind, fa }: { kind: "access" | "server"; fa: boolean }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground">
        {kind === "access" ? (
          <>
            <ShieldAlert className="size-7 text-destructive" />
            <p>{fa ? "دسترسی سوپرادمین لازمه." : "Super-admin access is required."}</p>
          </>
        ) : (
          <>
            <ServerCrash className="size-7 text-destructive" />
            <p>{fa ? "دریافت فهرست با خطا مواجه شد. دوباره تلاش کن." : "Couldn't load the list. Please try again."}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminPendingPayments() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Wallet deposits ─────────────────────────────────────────────────────
  const {
    data: deposits,
    isLoading: depositsLoading,
    error: depositsError,
  } = useQuery({
    queryKey: WALLET_KEY,
    queryFn: () => customFetch<WalletDeposit[]>("/api/admin/wallet-deposits"),
  });

  const [notes, setNotes] = useState<Record<string, string>>({});
  const [depositBusy, setDepositBusy] = useState<string | null>(null);

  async function actDeposit(txId: string, action: "approve" | "reject") {
    setDepositBusy("dep:" + txId + action);
    try {
      await customFetch(`/api/admin/wallet-deposits/${txId}/${action}`, {
        method: "POST",
        body: JSON.stringify({ reviewNote: notes[txId] || null }),
      });
      queryClient.invalidateQueries({ queryKey: WALLET_KEY });
      toast({
        title: action === "approve"
          ? (fa ? "واریز تأیید شد" : "Deposit approved")
          : (fa ? "واریز رد شد" : "Deposit rejected"),
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: e?.data?.error ?? e?.message });
    } finally {
      setDepositBusy(null);
    }
  }

  // ── Bot purchase receipts (legacy) ──────────────────────────────────────
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "pending-payments"],
    queryFn: () => customFetch<PendingItem[]>("/api/bots/pending-payments"),
  });

  const [busy, setBusy] = useState<string | null>(null);
  const [botNotFound, setBotNotFound] = useState<Record<string, boolean>>({});
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  async function act(paymentId: string, botId: string, action: "approve" | "reject") {
    setBusy(botId + action);
    try {
      const res = await customFetch<{ success: boolean; adminCode?: string }>(
        `/api/bots/${botId}/${action}-payment`,
        { method: "POST", body: JSON.stringify({}) },
      );
      if (action === "approve") {
        toast({
          title: fa ? "پرداخت تأیید شد ✅" : "Payment approved ✅",
          description: res.adminCode
            ? `${fa ? "کد ادمین" : "Admin code"}: ${res.adminCode}`
            : undefined,
        });
      } else {
        toast({ title: fa ? "پرداخت رد شد" : "Payment rejected" });
      }
      await refetch();
    } catch (e: any) {
      if (e?.status === 404) {
        setBotNotFound((prev) => ({ ...prev, [paymentId]: true }));
      }
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: e?.message });
    } finally {
      setBusy(null);
    }
  }

  async function cancelOrder(paymentId: string) {
    if (confirmCancel !== paymentId) {
      setConfirmCancel(paymentId);
      return;
    }
    setBusy("cancel:" + paymentId);
    try {
      await customFetch(`/api/bots/pending-payments/${paymentId}/cancel`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast({ title: fa ? "سفارش کنسل شد" : "Order cancelled" });
      await refetch();
    } catch (e: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: e?.message });
    } finally {
      setBusy(null);
      setConfirmCancel(null);
    }
  }

  const totalPending = (deposits?.length ?? 0) + (data?.length ?? 0);

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ClipboardList className="size-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">
            {fa ? "پرداخت‌های معلق" : "Pending Payments"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {fa
              ? "واریزهای کیف پول و فیش‌های سفارش بات، منتظر بررسی."
              : "Wallet deposits and bot-order receipts awaiting review."}
          </p>
        </div>
        {totalPending > 0 && (
          <Badge variant="secondary" className="ms-auto">
            {totalPending.toLocaleString(fa ? "fa-IR" : "en-US")}
          </Badge>
        )}
      </div>

      {/* ── Wallet deposits ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <WalletIcon className="size-4" /> {fa ? "واریز‌های کیف پول" : "Wallet deposits"}
        </h2>

        {depositsLoading ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {[1, 2].map((i) => (
              <Card key={i} className="animate-pulse"><CardContent className="h-40" /></Card>
            ))}
          </div>
        ) : depositsError ? (
          <ErrorState kind={classifyError(depositsError)} fa={fa} />
        ) : !deposits || deposits.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center">
            <Inbox className="size-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {fa ? "واریزی برای بررسی نیست." : "No deposits awaiting review."}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {deposits.map((d) => (
              <Card key={d.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span>{formatToman(d.amount, lang)}</span>
                    <Badge variant="outline">{d.type === "deposit_usdt" ? "USDT" : (fa ? "کارت" : "Card")}</Badge>
                  </CardTitle>
                  {d.user && <p className="text-xs text-muted-foreground">{d.user.name} · {d.user.email}</p>}
                </CardHeader>
                <CardContent className="space-y-3">
                  {d.receiptUrl && (
                    <ReceiptLightbox src={d.receiptUrl}>
                      <button type="button" className="block w-full text-start">
                        <img src={d.receiptUrl} alt="receipt" className="max-h-40 w-full rounded-md border object-contain bg-muted" />
                      </button>
                    </ReceiptLightbox>
                  )}
                  {d.txHash && <p className="break-all rounded-md bg-muted/50 p-2 font-mono text-xs" dir="ltr">{d.txHash}</p>}
                  <Input
                    placeholder={fa ? "یادداشت (اختیاری)" : "Review note (optional)"}
                    value={notes[d.id] ?? ""}
                    onChange={(e) => setNotes({ ...notes, [d.id]: e.target.value })}
                  />
                  <div className="flex gap-2">
                    <Button
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                      disabled={depositBusy !== null}
                      onClick={() => actDeposit(d.id, "approve")}
                    >
                      {depositBusy === "dep:" + d.id + "approve" ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="me-2 h-4 w-4" />}
                      {fa ? "تأیید" : "Approve"}
                    </Button>
                    <Button
                      variant="destructive"
                      className="flex-1"
                      disabled={depositBusy !== null}
                      onClick={() => actDeposit(d.id, "reject")}
                    >
                      {depositBusy === "dep:" + d.id + "reject" ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <XCircle className="me-2 h-4 w-4" />}
                      {fa ? "رد" : "Reject"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ── Bot purchase receipts (legacy) ──────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <BotIcon className="size-4" /> {fa ? "فیش‌های سفارش بات" : "Bot order receipts"}
        </h2>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse"><CardContent className="h-28" /></Card>
            ))}
          </div>
        ) : error ? (
          <ErrorState kind={classifyError(error)} fa={fa} />
        ) : !data || data.length === 0 ? (
          <div className="rounded-xl border border-dashed py-16 text-center">
            <Inbox className="mx-auto mb-3 size-10 text-muted-foreground" />
            <h3 className="text-lg font-semibold">{fa ? "چیزی برای بررسی نیست" : "Nothing to review"}</h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {fa ? "همه‌ی فیش‌ها بررسی شدن. فیشِ جدید که بیاد اینجا ظاهر می‌شه." : "All receipts are reviewed. New receipts will show up here."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {data.map((item, i) => {
              const botId = item.payment.botId ?? item.bot?.id ?? null;
              return (
                <motion.div
                  key={item.payment.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.3 }}
                >
                  <Card>
                    <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <span className="inline-flex items-center gap-1.5 font-medium">
                            <BotIcon className="size-4 text-primary" />
                            {item.bot ? item.bot.name : (fa ? "بدون بات" : "No bot")}
                            {item.bot && <span className="text-xs text-muted-foreground">@{item.bot.username}</span>}
                          </span>
                          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                            <UserIcon className="size-3.5" />
                            {item.user ? `${item.user.name} · ${item.user.email}` : "—"}
                          </span>
                        </div>
                        {item.payment.description && (
                          <p className="text-sm text-muted-foreground">{item.payment.description}</p>
                        )}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{new Date(item.payment.createdAt).toLocaleString(fa ? "fa-IR" : "en-US")}</span>
                          {item.payment.receiptUrl && (
                            <ReceiptLightbox src={item.payment.receiptUrl}>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                              >
                                <ExternalLink className="size-3.5" />
                                {fa ? "مشاهده فیش" : "View receipt"}
                              </button>
                            </ReceiptLightbox>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 gap-2">
                        <Button
                          size="sm"
                          onClick={() => botId && act(item.payment.id, botId, "approve")}
                          disabled={!botId || busy === botId + "approve"}
                          data-testid={`approve-${item.payment.id}`}
                        >
                          {busy === botId + "approve" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                          <span className="ms-1.5">{fa ? "تأیید" : "Approve"}</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => botId && act(item.payment.id, botId, "reject")}
                          disabled={!botId || busy === botId + "reject"}
                          data-testid={`reject-${item.payment.id}`}
                          className="text-destructive hover:text-destructive"
                        >
                          {busy === botId + "reject" ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
                          <span className="ms-1.5">{fa ? "رد" : "Reject"}</span>
                        </Button>
                      </div>
                    </CardContent>
                    {botNotFound[item.payment.id] && (
                      <CardContent className="flex flex-col gap-2 border-t border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <p className="flex items-center gap-1.5 text-xs text-destructive">
                          <AlertTriangle className="size-3.5 shrink-0" />
                          {fa ? "بات این سفارش پیدا نشد (احتمالاً حذف شده). می‌تونی کل سفارش رو کنسل کنی." : "This order's bot wasn't found (likely deleted). You can cancel the whole order."}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => cancelOrder(item.payment.id)}
                          disabled={busy === "cancel:" + item.payment.id}
                          className="shrink-0 border-destructive/50 text-destructive hover:bg-destructive/10"
                        >
                          {busy === "cancel:" + item.payment.id ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
                          <span className="ms-1.5">
                            {confirmCancel === item.payment.id
                              ? (fa ? "مطمئنی؟ دوباره بزن" : "Sure? Click again")
                              : (fa ? "کنسل کامل سفارش" : "Cancel order entirely")}
                          </span>
                        </Button>
                      </CardContent>
                    )}
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
