/**
 * InvoicesSection.tsx — IRFORGE_RECEIPT_DEBUG_INVOICES_PROMPT Part 2.
 *
 * A NEW VIEW on the exact same `payments` data Orders/Payments already read
 * (`GET /api/bots/:id/orders`) — deliberately not a second data source, per
 * this task's own explicit instruction. What's new here is purely:
 *   - `invoice_number`, a stable per-bot sequential reference the bot now
 *     stamps on every order at creation time (irforge-app commit e648b20),
 *     including orders that later get rejected;
 *   - the open/closed "bucket" view (`bucketOf()` in `routes/botOrders.ts`)
 *     instead of the four raw statuses Orders filters by.
 *
 * Read-only by design: approving/rejecting/postponing an order is Orders'
 * job (it already owns that mutation and its own confirmation dialog) — an
 * admin-facing reference list shouldn't duplicate a second place to change
 * an order's outcome.
 *
 * The 4th bucket the original prompt imagined — "Open, no receipt yet" —
 * doesn't exist in this data: `handlers/payment.py` only ever creates an
 * order once a receipt/tracking code actually arrives, there is no earlier
 * "order intent" record anywhere. Confirmed with the user; this view shows
 * the three real states instead of inventing a fourth.
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { Loader2, Search, Check, X, Clock, ChevronRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { formatOrderAmount } from "@/lib/order-amount";

type Order = {
  order_id: string;
  invoice_number?: number;
  user_id: string;
  username: string;
  amount: unknown;
  final_amount?: unknown;
  method?: string;
  receipt_file_id?: string;
  receipt_text?: string;
  description?: string;
  status: string;
  created_at?: string;
  reviewed_at?: string;
  status_reason?: string;
};

type InvoicesPage = {
  orders: Order[];
  page: number;
  totalPages: number;
  total: number;
  bucketCounts: { open: number; closed: number };
  currency: string;
};

type Bucket = "all" | "open" | "closed";

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}

export function InvoicesSection({ bot }: { bot: Bot }) {
  const t = useT("botOrders");
  const { lang } = useLanguage();

  const [search, setSearch] = useState("");
  const [bucket, setBucket] = useState<Bucket>("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Order | null>(null);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["bot-invoices", bot.id, search, bucket, page],
    queryFn: () =>
      customFetch<InvoicesPage>(
        `/api/bots/${bot.id}/orders?search=${encodeURIComponent(search)}&bucket=${bucket}&page=${page}&limit=30`
      ),
    placeholderData: keepPreviousData,
  });

  const nf = (n: number) => n.toLocaleString(lang === "fa" ? "fa-IR" : "en-US");

  function statusBadge(s: string) {
    const label = (t[`status_${s}` as keyof typeof t] as string) ?? s;
    if (s === "verified") return <Badge><Check className="me-1 size-3" />{label}</Badge>;
    if (s === "rejected") return <Badge variant="destructive"><X className="me-1 size-3" />{label}</Badge>;
    if (s === "postponed") return <Badge variant="outline"><Clock className="me-1 size-3" />{label}</Badge>;
    return <Badge variant="secondary">{label}</Badge>;
  }

  if (isLoading && !data) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t.loading}
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {errCode(error) === "no_sheet"
          ? t.noSheetYet
          : errCode(error) === "plugin_disabled"
            ? t.walletPluginRequired
            : errMessage(error, t.errorGeneric)}
      </div>
    );
  }

  const totalCount = data.bucketCounts.open + data.bucketCounts.closed;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 ms-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-8" placeholder={t.invoiceSearchPlaceholder}
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Select value={bucket} onValueChange={(v) => { setBucket(v as Bucket); setPage(1); }}>
          <SelectTrigger className="w-auto min-w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.filterAll} ({nf(totalCount)})</SelectItem>
            <SelectItem value="open">{t.bucketOpen} ({nf(data.bucketCounts.open)})</SelectItem>
            <SelectItem value="closed">{t.bucketClosed} ({nf(data.bucketCounts.closed)})</SelectItem>
          </SelectContent>
        </Select>
        {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>

      {data.orders.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {totalCount === 0 ? t.noInvoices : t.noInvoiceMatches}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-start font-medium">{t.colInvoiceNumber}</th>
                <th className="p-2 text-start font-medium">{t.colUser}</th>
                <th className="p-2 text-start font-medium">{t.colAmount}</th>
                <th className="p-2 text-start font-medium">{t.colDate}</th>
                <th className="p-2 text-start font-medium">{t.colStatus}</th>
              </tr>
            </thead>
            <motion.tbody
              initial="hidden"
              animate="show"
              variants={{ show: { transition: { staggerChildren: 0.03 } } }}
            >
              {data.orders.map((order) => (
                <motion.tr
                  key={order.order_id}
                  variants={{ hidden: { opacity: 0, y: 4 }, show: { opacity: 1, y: 0 } }}
                  transition={{ duration: 0.2 }}
                  className="cursor-pointer border-t hover:bg-muted/40"
                  onClick={() => setSelected(order)}
                >
                  <td className="p-2">
                    <code dir="ltr" className="font-mono text-xs">
                      {order.invoice_number != null ? `#${nf(order.invoice_number)}` : "—"}
                    </code>
                  </td>
                  <td className="p-2" dir="ltr">{order.username || order.user_id}</td>
                  <td className="p-2">{formatOrderAmount(order.final_amount ?? order.amount, data.currency, lang)}</td>
                  <td className="p-2" dir="ltr">{String(order.created_at ?? "").slice(0, 10) || "—"}</td>
                  <td className="p-2">{statusBadge(order.status ?? "pending")}</td>
                </motion.tr>
              ))}
            </motion.tbody>
          </table>
        </div>
      )}

      {data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="icon" aria-label={t.prevPage} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronRight className="size-4 rtl-flip" />
          </Button>
          <span className="text-sm text-muted-foreground">
            {t.pageOf.replace("{page}", nf(data.page)).replace("{total}", nf(data.totalPages))}
          </span>
          <Button variant="outline" size="icon" aria-label={t.nextPage} disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
            <ChevronLeft className="size-4 rtl-flip" />
          </Button>
        </div>
      )}

      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t.invoiceDetailTitle}</DialogTitle>
            <DialogDescription dir="ltr">
              {selected?.invoice_number != null ? `#${nf(selected.invoice_number)}` : selected?.order_id}
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">{t.colUser}</dt>
                <dd dir="ltr">{selected.username || selected.user_id}</dd>
                <dt className="text-muted-foreground">{t.colAmount}</dt>
                <dd>{formatOrderAmount(selected.final_amount ?? selected.amount, data.currency, lang)}</dd>
                <dt className="text-muted-foreground">{t.colMethod}</dt>
                <dd>{selected.method || "—"}</dd>
                <dt className="text-muted-foreground">{t.colStatus}</dt>
                <dd>{statusBadge(selected.status ?? "pending")}</dd>
                <dt className="text-muted-foreground">{t.stageCreated}</dt>
                <dd dir="ltr">{String(selected.created_at ?? "").slice(0, 16).replace("T", " ") || "—"}</dd>
                <dt className="text-muted-foreground">{t.stageReviewed}</dt>
                <dd dir="ltr">{String(selected.reviewed_at ?? "").slice(0, 16).replace("T", " ") || "—"}</dd>
              </dl>

              {selected.description && <p className="text-sm">{selected.description}</p>}
              {selected.receipt_text && (
                <p className="rounded-md border bg-muted/40 p-2 text-sm whitespace-pre-wrap">{selected.receipt_text}</p>
              )}

              {selected.receipt_file_id && (
                <div className="space-y-1.5">
                  <Label>{t.receipt}</Label>
                  <img
                    src={`/api/bots/${bot.id}/media/${encodeURIComponent(selected.receipt_file_id)}`}
                    alt={t.receipt}
                    loading="lazy"
                    decoding="async"
                    className="max-h-72 w-full rounded-md border object-contain"
                  />
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
