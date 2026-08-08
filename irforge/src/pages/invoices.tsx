import { customFetch } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Receipt, ExternalLink, Bot, Wallet } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";
import { ReceiptLightbox } from "@/components/ui/receipt-lightbox";

type Payment = {
  id: string; botId: string | null; botName: string | null; amount: number | null;
  receiptUrl: string; description: string | null; status: string; reviewNote: string | null; createdAt: string;
};
type WalletTx = { id: string; type: string; amount: number; status: string; receiptUrl: string | null; createdAt: string };

type Row = {
  key: string; kind: "bot" | "wallet"; label: string; sub: string | null;
  amount: number | null; status: string; receiptUrl: string | null; createdAt: string; spend: boolean;
};

const STATUS: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; fa: string; en: string }> = {
  pending: { variant: "outline", fa: "در انتظار", en: "pending" },
  approved: { variant: "default", fa: "تأییدشده", en: "approved" },
  rejected: { variant: "destructive", fa: "ردشده", en: "rejected" },
};
const WALLET_LABEL: Record<string, { fa: string; en: string }> = {
  deposit_card: { fa: "واریز کارت به کارت", en: "Card deposit" },
  deposit_gateway: { fa: "واریز درگاه", en: "Gateway deposit" },
  deposit_usdt: { fa: "واریز تتر", en: "USDT deposit" },
  spend: { fa: "خرید از کیف پول", en: "Wallet spend" },
  referral_credit: { fa: "پاداش", en: "Referral credit" },
};

export default function Invoices() {
  const { lang } = useLanguage();
  const fa = lang === "fa";

  const { data: payments, isLoading: l1 } = useQuery({
    queryKey: ["my-payments"], queryFn: () => customFetch<Payment[]>("/api/payments/me"),
  });
  const { data: walletTx, isLoading: l2 } = useQuery({
    queryKey: ["wallet-tx"], queryFn: () => customFetch<WalletTx[]>("/api/wallet/transactions"),
  });

  const rows: Row[] = [
    ...(payments ?? []).map((p): Row => ({
      key: "p:" + p.id, kind: "bot",
      label: p.botName ? (fa ? `ربات: ${p.botName}` : `Bot: ${p.botName}`) : (fa ? "پرداخت" : "Payment"),
      sub: p.description, amount: p.amount, status: p.status, receiptUrl: p.receiptUrl, createdAt: p.createdAt, spend: false,
    })),
    ...(walletTx ?? []).map((t): Row => {
      const lbl = WALLET_LABEL[t.type] ?? { fa: t.type, en: t.type };
      return {
        key: "w:" + t.id, kind: "wallet", label: fa ? lbl.fa : lbl.en, sub: null,
        amount: t.amount, status: t.status, receiptUrl: t.receiptUrl, createdAt: t.createdAt, spend: t.type === "spend",
      };
    }),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const isLoading = l1 || l2;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{fa ? "فاکتورهای من" : "My Invoices"}</h1>
        <p className="text-muted-foreground">{fa ? "تاریخچهٔ مالی: خرید ربات و تراکنش‌های کیف پول." : "Financial history: bot purchases and wallet transactions."}</p>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />)}</div>
      ) : rows.length > 0 ? (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{fa ? "شرح" : "Description"}</TableHead>
                <TableHead>{fa ? "مبلغ" : "Amount"}</TableHead>
                <TableHead>{fa ? "وضعیت" : "Status"}</TableHead>
                <TableHead className="hidden md:table-cell">{fa ? "تاریخ" : "Date"}</TableHead>
                <TableHead className="text-end">{fa ? "فیش" : "Receipt"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const s = STATUS[r.status] ?? STATUS.pending;
                return (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {r.kind === "wallet" ? <Wallet className="h-3.5 w-3.5 text-muted-foreground" /> : <Bot className="h-3.5 w-3.5 text-muted-foreground" />}
                        {r.label}
                      </span>
                      {r.sub && <span className="text-xs text-muted-foreground">{r.sub}</span>}
                    </TableCell>
                    <TableCell className={r.spend ? "text-red-500" : ""}>
                      {r.amount != null ? `${r.spend ? "−" : ""}${formatToman(r.amount, lang)}` : "—"}
                    </TableCell>
                    <TableCell><Badge variant={s.variant}>{fa ? s.fa : s.en}</Badge></TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">{new Date(r.createdAt).toLocaleDateString(fa ? "fa-IR" : "en-US")}</TableCell>
                    <TableCell className="text-end">
                      {r.receiptUrl ? (
                        <ReceiptLightbox src={r.receiptUrl}>
                          <Button variant="ghost" size="sm">
                            <ExternalLink className="me-1 h-3.5 w-3.5" /> {fa ? "مشاهده" : "View"}
                          </Button>
                        </ReceiptLightbox>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-16 text-center">
          <Receipt className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{fa ? "هنوز تراکنشی ندارید." : "No transactions yet."}</p>
        </div>
      )}
    </div>
  );
}
