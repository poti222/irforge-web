import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Wallet, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";
import { PlatformTopupPanel } from "@/components/wallet/PlatformTopupPanel";
import { getSchoolWallet, listSchoolWalletTransactions, type SchoolWalletTxn } from "@/lib/schools-api";

/**
 * کیف پولِ مدرسه — کاملاً جدا از «کیف پول» شخصی (/wallet). مبالغ در API ریال‌اند؛ در UI تومان (÷۱۰) نمایش داده می‌شود.
 * شارژ = «درخواستِ شارژ» که پشتیبانی تأیید می‌کند (نه رفتن به /wallet).
 */
export const schoolWalletKey = (schoolId: string) => ["schools", "wallet", schoolId] as const;

export function useSchoolWallet(schoolId: string) {
  return useQuery({ queryKey: schoolWalletKey(schoolId), queryFn: () => getSchoolWallet(schoolId) });
}

/** همان پنلِ «شارژ خودکار» کیف‌پولِ شخصی، فقط رویِ APIِ کیف‌پولِ مدرسه؛ بعد از تأیید موجودیِ مدرسه تازه می‌شود. */
export function SchoolWalletTopupPanel({ schoolId }: { schoolId: string }) {
  const qc = useQueryClient();
  const { lang } = useLanguage();
  return (
    <PlatformTopupPanel
      fa={lang === "fa"} lang={lang} target="school" apiBase={`/api/schools/${schoolId}/wallet/topup`}
      onCredited={() => { qc.invalidateQueries({ queryKey: schoolWalletKey(schoolId) }); }}
    />
  );
}

export function SchoolWalletTopupDialog({ schoolId, open, onOpenChange }: { schoolId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useT("schools") as any;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.swTopUp}</DialogTitle>
          <DialogDescription>{t.swTopUpDescription}</DialogDescription>
        </DialogHeader>
        {open && <SchoolWalletTopupPanel schoolId={schoolId} />}
      </DialogContent>
    </Dialog>
  );
}

function typeLabel(t: any, type: SchoolWalletTxn["type"]) {
  return { credit: t.swTypeCredit, spend: t.swTypeSpend, admin_credit: t.swTypeAdminCredit, admin_debit: t.swTypeAdminDebit }[type];
}

export function SchoolWalletCard({ schoolId }: { schoolId: string }) {
  const t = useT("schools") as any;
  const { lang } = useLanguage();
  const { data, isLoading } = useSchoolWallet(schoolId);
  const [extra, setExtra] = useState<SchoolWalletTxn[]>([]);
  const [hasMore, setHasMore] = useState<boolean | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const txns = [...(data?.transactions ?? []), ...extra.filter((e) => !data?.transactions.some((d) => d.id === e.id))];
  const more = hasMore ?? data?.hasMore ?? false;

  async function loadMore() {
    const last = txns.at(-1);
    if (!last) return;
    setLoadingMore(true);
    try {
      const r = await listSchoolWalletTransactions(schoolId, last.createdAt);
      setExtra((x) => [...x, ...r.transactions]);
      setHasMore(r.hasMore);
    } finally { setLoadingMore(false); }
  }

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(lang === "fa" ? "fa-IR" : "en-US");

  return (
    <Card data-testid="school-wallet-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Wallet className="size-5" /> {t.swTitle}</CardTitle>
        <CardDescription>{t.swDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" /> <span>{t.swSeparateNote}</span>
        </div>
        {isLoading ? <Loader2 className="size-5 animate-spin" /> : data && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs text-muted-foreground">{t.swBalance}</div>
                <div className="text-2xl font-bold" data-testid="school-wallet-balance">{formatToman(data.balanceRial / 10, lang)}</div>
              </div>
            </div>

            <div className="rounded-lg border p-3" data-testid="school-wallet-topup">
              <div className="mb-1 flex items-center gap-2 text-sm font-medium"><Wallet className="size-4" />{t.swTopUp}</div>
              <SchoolWalletTopupPanel schoolId={schoolId} />
            </div>

            <div className="space-y-1.5">
              <div className="text-sm font-medium">{t.swTransactions}</div>
              {txns.length === 0 ? (
                <div className="rounded-md border border-dashed p-3 text-center text-sm text-muted-foreground">{t.swNoTransactions}</div>
              ) : (
                <ul className="divide-y rounded-md border text-sm">
                  {txns.map((x) => {
                    const out = x.type === "spend" || x.type === "admin_debit";
                    return (
                      <li key={x.id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2"><Badge variant="outline" className="text-[10px]">{typeLabel(t, x.type)}</Badge><span className="truncate">{x.description}</span></div>
                          <div className="text-xs text-muted-foreground">{fmtDate(x.createdAt)}</div>
                        </div>
                        <span className={`shrink-0 font-medium ${out ? "text-destructive" : "text-emerald-600"}`} dir="ltr">{out ? "-" : "+"}{formatToman(x.amountRial / 10, lang)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {more && <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>{loadingMore && <Loader2 className="me-2 size-4 animate-spin" />}{t.swLoadMore}</Button>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
