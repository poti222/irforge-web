import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ReceiptLightbox } from "@/components/ui/receipt-lightbox";
import { Check, X, Loader2, Inbox, Wallet as WalletIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";

type WalletDeposit = {
  id: string; type: string; amount: number; status: string;
  receiptUrl: string | null; txHash: string | null; createdAt: string;
  user: { id: string; name: string; email: string } | null;
};

// Exported so both the admin panel's header RefreshButton (Phase 13) and the
// super-admin Pending Payments page (Phase 12) can watch/invalidate the same
// wallet-deposits cache entry.
export const WALLET_KEY = ["wallet-deposits"] as const;

export function PaymentApprovals() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: deposits, isLoading } = useQuery({
    queryKey: WALLET_KEY,
    queryFn: () => customFetch<WalletDeposit[]>("/api/admin/wallet-deposits"),
  });

  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

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

  const noDeposits = !deposits || deposits.length === 0;

  if (isLoading) {
    return <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-md bg-muted" />)}</div>;
  }

  return (
    <div className="space-y-8">
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
                    <ReceiptLightbox src={d.receiptUrl}>
                      <button type="button" className="block w-full text-start">
                        <img src={d.receiptUrl} alt="receipt" className="max-h-40 w-full rounded-md border object-contain bg-muted" />
                      </button>
                    </ReceiptLightbox>
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
