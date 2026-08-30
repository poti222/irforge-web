/**
 * WalletTopupMonitor.tsx — دیده‌بانیِ شارژِ خودکارِ کیف‌پول (بلوبانک).
 *
 * برخلافِ PaymentApprovals (کارت‌به‌کارت/تتر) این‌جا اکثرِ سفارش‌ها خودشان با
 * پیامکِ بانکی confirm می‌شوند — این پنل برای دیده‌بانی و رفعِ اشکال است:
 * سفارش‌های هنوز pending (با دکمه‌ی تأییدِ دستی برای وقتی پیامک نرسیده) و
 * پیامک‌هایی که به هیچ سفارشی match نشدند.
 */
import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, MessageSquareWarning, ReceiptText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";

type WalletTopupRow = {
  id: string;
  requestedAmount: number;
  suffix: number;
  finalAmount: number;
  status: "pending" | "confirmed" | "expired" | "canceled";
  createdAt: string;
  expiresAt: string | null;
  confirmedAt: string | null;
  user: { id: string; name: string; email: string } | null;
};

type SmsLogRow = {
  id: string;
  rawText: string;
  sender: string | null;
  parsedAmount: number | null;
  matchedPaymentId: string | null;
  receivedAt: string;
};

const TOPUPS_KEY = ["admin-wallet-topups"] as const;
const SMS_LOGS_KEY = ["admin-wallet-topup-sms-logs"] as const;

function statusVariant(status: WalletTopupRow["status"]): "default" | "outline" | "secondary" | "destructive" {
  if (status === "confirmed") return "default";
  if (status === "pending") return "secondary";
  return "outline";
}

export function WalletTopupMonitor() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: topups, isLoading: loadingTopups } = useQuery({
    queryKey: TOPUPS_KEY,
    queryFn: () => customFetch<WalletTopupRow[]>("/api/admin/wallet-topups"),
  });
  const { data: smsLogs, isLoading: loadingSms } = useQuery({
    queryKey: SMS_LOGS_KEY,
    queryFn: () => customFetch<SmsLogRow[]>("/api/admin/wallet-topup-sms-logs"),
  });

  async function manualConfirm(id: string) {
    setBusyId(id);
    try {
      await customFetch(`/api/admin/wallet-topups/${id}/manual-confirm`, { method: "POST" });
      queryClient.invalidateQueries({ queryKey: TOPUPS_KEY });
      toast({ title: fa ? "شارژ تأیید شد" : "Top-up confirmed" });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    } finally {
      setBusyId(null);
    }
  }

  const unmatchedSms = (smsLogs ?? []).filter((l) => !l.matchedPaymentId);
  const pendingTopups = (topups ?? []).filter((t) => t.status === "pending");
  const recentTopups = (topups ?? []).slice(0, 30);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ReceiptText className="size-4 text-muted-foreground" />
            {fa ? "سفارش‌های شارژ خودکار (بلوبانک)" : "Automatic top-up orders (BluBank)"}
          </CardTitle>
          <CardDescription>
            {fa
              ? "بیشتر سفارش‌ها با تشخیصِ خودکارِ پیامکِ بانکی تأیید می‌شوند. سفارش‌های pending را فقط وقتی پیامک نرسیده ولی پول واقعاً واریز شده، دستی تأیید کنید."
              : "Most orders confirm automatically from bank SMS. Only manually confirm a pending order if the SMS never arrived but the money genuinely landed."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingTopups ? (
            <div className="h-32 animate-pulse rounded-md bg-muted" />
          ) : (topups ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{fa ? "هنوز سفارشی ثبت نشده." : "No orders yet."}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs text-muted-foreground">
                    <th className="p-2 text-start">{fa ? "کاربر" : "User"}</th>
                    <th className="p-2 text-start">{fa ? "مبلغ درخواستی" : "Requested"}</th>
                    <th className="p-2 text-start">{fa ? "مبلغ نهایی" : "Final amount"}</th>
                    <th className="p-2 text-start">{fa ? "وضعیت" : "Status"}</th>
                    <th className="p-2 text-start">{fa ? "زمان" : "Time"}</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {recentTopups.map((t) => (
                    <tr key={t.id} className="border-b last:border-0">
                      <td className="p-2">{t.user ? `${t.user.name} · ${t.user.email}` : "—"}</td>
                      <td className="p-2">{formatToman(t.requestedAmount, lang)}</td>
                      <td className="p-2 font-mono">{formatToman(t.finalAmount, lang)}</td>
                      <td className="p-2">
                        <Badge variant={statusVariant(t.status)}>
                          {fa
                            ? { pending: "در انتظار", confirmed: "تأیید شده", expired: "منقضی", canceled: "لغو شده" }[t.status]
                            : t.status}
                        </Badge>
                      </td>
                      <td className="p-2 text-xs text-muted-foreground" dir="ltr">{new Date(t.createdAt).toLocaleString(fa ? "fa-IR" : undefined)}</td>
                      <td className="p-2 text-end">
                        {t.status === "pending" && (
                          <Button size="sm" variant="outline" disabled={busyId !== null} onClick={() => manualConfirm(t.id)}>
                            {busyId === t.id ? <Loader2 className="me-1 size-3.5 animate-spin" /> : null}
                            {fa ? "تأیید دستی" : "Manual confirm"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pendingTopups.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {fa ? `${pendingTopups.length} سفارش در انتظارِ پیامک` : `${pendingTopups.length} order(s) awaiting SMS`}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquareWarning className="size-4 text-muted-foreground" />
            {fa ? "پیامک‌های بی‌مقصد" : "Unmatched SMS"}
          </CardTitle>
          <CardDescription>
            {fa
              ? "پیامک‌هایی که مبلغِ واریزی‌شان با هیچ سفارشِ pendingی مطابقت نداشت — یعنی سفارش منقضی شده یا اصلاً ثبت نشده بود."
              : "SMS messages whose amount matched no pending order — the order had expired or was never created."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingSms ? (
            <div className="h-20 animate-pulse rounded-md bg-muted" />
          ) : unmatchedSms.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{fa ? "همه چیز match شده." : "Nothing unmatched."}</p>
          ) : (
            <ul className="space-y-2">
              {unmatchedSms.map((l) => (
                <li key={l.id} className="rounded-md border p-2 text-xs">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span dir="ltr">{new Date(l.receivedAt).toLocaleString(fa ? "fa-IR" : undefined)}</span>
                    {l.parsedAmount != null && <span>{formatToman(l.parsedAmount, lang)}</span>}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words font-mono">{l.rawText}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
