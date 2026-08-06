import { useState } from "react";
import { customFetch, getAdminGetStatsQueryKey } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Check, X, Loader2, Inbox, ExternalLink, Wallet as WalletIcon, Ban, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";

type PendingPayment = {
  payment: { id: string; botId: string | null; receiptUrl: string | null; description: string | null; status: string; createdAt: string };
  bot: { id: string; name: string; status: string } | null;
  user: { id: string; name: string; email: string; telegramId: string | null } | null;
};
type WalletDeposit = {
  id: string; type: string; amount: number; status: string;
  receiptUrl: string | null; txHash: string | null; createdAt: string;
  user: { id: string; name: string; email: string } | null;
};

const PENDING_KEY = ["pending-payments"] as const;
const WALLET_KEY = ["wallet-deposits"] as const;

export function PaymentApprovals() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: pending, isLoading } = useQuery({
    queryKey: PENDING_KEY,
    queryFn: () => customFetch<PendingPayment[]>("/api/bots/pending-payments"),
  });
  const { data: deposits } = useQuery({
    queryKey: WALLET_KEY,
    queryFn: () => customFetch<WalletDeposit[]>("/api/admin/wallet-deposits"),
  });

  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [botNotFound, setBotNotFound] = useState<Record<string, boolean>>({});
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  async function actBot(paymentId: string, botId: string, action: "approve" | "reject") {
    setBusyId("bot:" + botId + action);
    try {
      await customFetch(`/api/bots/${botId}/${action}-payment`, {
        method: "POST",
        body: JSON.stringify({ reviewNote: notes[botId] || null }),
      });
      queryClient.invalidateQueries({ queryKey: PENDING_KEY });
      queryClient.invalidateQueries({ queryKey: getAdminGetStatsQueryKey() });
      toast({ title: action === "approve" ? (fa ? "پرداخت تأیید شد" : "Payment approved") : (fa ? "پرداخت رد شد" : "Payment rejected") });
    } catch (err: any) {
      if (err?.status === 404) {
        setBotNotFound((prev) => ({ ...prev, [paymentId]: true }));
      }
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    } finally { setBusyId(null); }
  }

  async function cancelOrder(paymentId: string) {
    if (confirmCancel !== paymentId) {
      setConfirmCancel(paymentId);
      return;
    }
    setBusyId("cancel:" + paymentId);
    try {
      await customFetch(`/api/bots/pending-payments/${paymentId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reviewNote: notes[paymentId] || null }),
      });
      queryClient.invalidateQueries({ queryKey: PENDING_KEY });
      queryClient.invalidateQueries({ queryKey: getAdminGetStatsQueryKey() });
      toast({ title: fa ? "سفارش کنسل شد" : "Order cancelled" });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    } finally {
      setBusyId(null);
      setConfirmCancel(null);
    }
  }

  async function actDeposit(txId: string, action: "approve" | "reject") {
    setBusyId("dep:" + txId + action);
    try {
      await customFetch(`/api/admin/wallet-deposits/${txId}/${action}`, {
        method: "POST",
        body: JSON.stringify({ reviewNote: notes[txId] || null }),
      });
      queryClient.invalidateQueries({ queryKey: WALLET_KEY });
      toast({ title: action === "approve" ? (fa ? "واریز تأیید شد" : "Deposit approved") : (fa ? "واریز رد شد" : "Deposit rejected") });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    } finally { setBusyId(null); }
  }

  const noBots = !pending || pending.length === 0;
  const noDeposits = !deposits || deposits.length === 0;

  if (isLoading) {
    return <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-md bg-muted" />)}</div>;
  }

  return (
    <div className="space-y-8">
      {/* Bot purchase receipts */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">{fa ? "فیش‌های خرید ربات" : "Bot purchase receipts"}</h3>
        {noBots ? (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center">
            <Inbox className="h-7 w-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{fa ? "پرداخت در انتظاری نیست." : "No pending payments."}</p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {pending!.map(({ payment, bot, user }) => {
              const botId = payment.botId ?? bot?.id ?? null;
              return (
              <Card key={payment.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span>{bot?.name ?? (fa ? "بات نامشخص" : "Unknown bot")}</span>
                    <Badge variant="outline" className="border-amber-500 text-amber-500">{fa ? "در انتظار" : "pending"}</Badge>
                  </CardTitle>
                  {user && <p className="text-xs text-muted-foreground">{user.name} · {user.email}{user.telegramId ? ` · TG:${user.telegramId}` : ""}</p>}
                </CardHeader>
                <CardContent className="space-y-3">
                  {payment.receiptUrl && (
                    <Dialog>
                      <DialogTrigger asChild>
                        <button type="button" className="block w-full text-start">
                          <img src={payment.receiptUrl} alt="receipt" className="max-h-48 w-full rounded-md border object-contain bg-muted" />
                          <span className="mt-1 flex items-center gap-1 text-xs text-primary"><ExternalLink className="h-3 w-3" /> {fa ? "مشاهده اصل" : "Open full"}</span>
                        </button>
                      </DialogTrigger>
                      <DialogContent className="max-w-3xl">
                        <img src={payment.receiptUrl} alt="receipt" className="max-h-[80vh] w-full rounded-md object-contain" />
                      </DialogContent>
                    </Dialog>
                  )}
                  {payment.description && <p className="rounded-md bg-muted/50 p-2 text-sm">{payment.description}</p>}
                  <Input placeholder={fa ? "یادداشت (اختیاری)" : "Review note (optional)"} value={notes[botId ?? payment.id] ?? ""} onChange={(e) => setNotes({ ...notes, [botId ?? payment.id]: e.target.value })} />
                  <div className="flex gap-2">
                    <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" disabled={!botId || busyId !== null} onClick={() => botId && actBot(payment.id, botId, "approve")}>
                      {busyId === "bot:" + (botId ?? "") + "approve" ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Check className="me-2 h-4 w-4" />}{fa ? "تأیید" : "Approve"}
                    </Button>
                    <Button variant="destructive" className="flex-1" disabled={!botId || busyId !== null} onClick={() => botId && actBot(payment.id, botId, "reject")}>
                      {busyId === "bot:" + (botId ?? "") + "reject" ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <X className="me-2 h-4 w-4" />}{fa ? "رد" : "Reject"}
                    </Button>
                  </div>
                  {botNotFound[payment.id] && (
                    <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-2">
                      <p className="flex items-center gap-1.5 text-xs text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {fa ? "بات این سفارش پیدا نشد (احتمالاً حذف شده). می‌تونی کل سفارش رو کنسل کنی." : "This order's bot wasn't found (likely deleted). You can cancel the whole order."}
                      </p>
                      <Button
                        variant="outline"
                        className="w-full border-destructive/50 text-destructive hover:bg-destructive/10"
                        disabled={busyId !== null}
                        onClick={() => cancelOrder(payment.id)}
                      >
                        {busyId === "cancel:" + payment.id ? (
                          <Loader2 className="me-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Ban className="me-2 h-4 w-4" />
                        )}
                        {confirmCancel === payment.id
                          ? (fa ? "مطمئنی؟ دوباره بزن برای کنسل کامل" : "Sure? Click again to confirm")
                          : (fa ? "کنسل کامل سفارش" : "Cancel order entirely")}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Wallet deposits */}
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <WalletIcon className="h-4 w-4" /> {fa ? "واریز‌های کیف پول" : "Wallet deposits"}
        </h3>
        {noDeposits ? (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center">
            <Inbox className="h-7 w-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{fa ? "واریز در انتظاری نیست." : "No pending deposits."}</p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {deposits!.map((d) => (
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
                    <Dialog>
                      <DialogTrigger asChild>
                        <button type="button" className="block w-full text-start">
                          <img src={d.receiptUrl} alt="receipt" className="max-h-40 w-full rounded-md border object-contain bg-muted" />
                        </button>
                      </DialogTrigger>
                      <DialogContent className="max-w-3xl">
                        <img src={d.receiptUrl} alt="receipt" className="max-h-[80vh] w-full rounded-md object-contain" />
                      </DialogContent>
                    </Dialog>
                  )}
                  {d.txHash && <p className="break-all rounded-md bg-muted/50 p-2 font-mono text-xs" dir="ltr">{d.txHash}</p>}
                  <Input placeholder={fa ? "یادداشت (اختیاری)" : "Review note (optional)"} value={notes[d.id] ?? ""} onChange={(e) => setNotes({ ...notes, [d.id]: e.target.value })} />
                  <div className="flex gap-2">
                    <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" disabled={busyId !== null} onClick={() => actDeposit(d.id, "approve")}>
                      {busyId === "dep:" + d.id + "approve" ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Check className="me-2 h-4 w-4" />}{fa ? "تأیید" : "Approve"}
                    </Button>
                    <Button variant="destructive" className="flex-1" disabled={busyId !== null} onClick={() => actDeposit(d.id, "reject")}>
                      {busyId === "dep:" + d.id + "reject" ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <X className="me-2 h-4 w-4" />}{fa ? "رد" : "Reject"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
