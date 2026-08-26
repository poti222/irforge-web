/**
 * OrdersSection.tsx — سفارش‌ها و رسیدها (فاز ۱۶).
 *
 * تصویر رسید از پروکسی سرور می‌آید (`/api/bots/:id/media/:fileId`) — URL خام
 * تلگرام توکن بات را داخل خودش دارد و هرگز به مرورگر نمی‌رسد.
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { Loader2, Search, Check, X, Clock, ChevronRight, ChevronLeft, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";
import { formatOrderAmount } from "@/lib/order-amount";

type Order = {
  order_id: string;
  user_id: string;
  username: string;
  amount: unknown;
  final_amount?: unknown;
  method?: string;
  receipt_file_id?: string;
  receipt_text?: string;
  duplicate_of?: string;
  description?: string;
  status: string;
  created_at?: string;
  status_reason?: string;
};

type OrdersPage = {
  orders: Order[];
  page: number;
  totalPages: number;
  total: number;
  counts: Record<string, number>;
  statuses: string[];
  /** P51: the bot's own configured currency — orders live in a sheet, not a
      Toman-only column, so a bot set up for USD has USD amounts here. */
  currency: string;
};

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}

export function OrdersSection({ bot }: { bot: Bot }) {
  const t = useT("botOrders");
  const { lang } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Order | null>(null);
  const [reason, setReason] = useState("");

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["bot-orders", bot.id, search, status, page],
    queryFn: () =>
      customFetch<OrdersPage>(
        `/api/bots/${bot.id}/orders?search=${encodeURIComponent(search)}&status=${status}&page=${page}&limit=30`
      ),
    placeholderData: keepPreviousData,
  });

  const setStatusMutation = useMutation({
    mutationFn: ({ orderId, next, why }: { orderId: string; next: string; why: string }) =>
      customFetch<{ order: Order; notified: string; notifyError: string | null }>(
        `/api/bots/${bot.id}/orders/${orderId}/status`,
        { method: "POST", body: JSON.stringify({ status: next, reason: why }) }
      ),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["bot-orders", bot.id] });
      setSelected(null);
      setReason("");
      // شکست ارسال پیام، وضعیت را برنمی‌گرداند — ولی کاربر باید بداند.
      toast(
        result.notified === "failed"
          ? {
              variant: "destructive",
              title: t.statusSavedNoMessage,
              description: result.notifyError ?? undefined,
            }
          : { title: result.notified === "sent" ? t.statusSavedAndSent : t.statusSaved }
      );
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
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
    // `plugin_disabled` خطا نیست: کاربر با یک بوکمارک قدیمی رسیده به سکشنی که
    // دیگر در نوار کناری نیست. پیام باید بگوید کجا روشنش کند.
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 ms-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-8" placeholder={t.searchPlaceholder}
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-auto min-w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.filterAll} ({nf(data.counts.all ?? 0)})</SelectItem>
            {data.statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {(t[`status_${s}` as keyof typeof t] as string) ?? s} ({nf(data.counts[s] ?? 0)})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>

      {data.orders.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {data.counts.all === 0 ? t.noOrders : t.noMatches}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-start font-medium">{t.colOrderId}</th>
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
                  onClick={() => { setSelected(order); setReason(order.status_reason ?? ""); }}
                >
                  <td className="p-2">
                    <code dir="ltr" className="font-mono text-xs">{String(order.order_id).slice(0, 12)}</code>
                    {order.duplicate_of && (
                      <AlertTriangle className="ms-1 inline size-3.5 text-amber-500" aria-label={t.duplicateReceipt} />
                    )}
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

      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) { setSelected(null); setReason(""); } }}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t.detailTitle}</DialogTitle>
            <DialogDescription dir="ltr">{selected?.order_id}</DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-4">
              {selected.duplicate_of && (
                <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span dir="ltr">{t.duplicateOf.replace("{id}", String(selected.duplicate_of))}</span>
                </p>
              )}

              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">{t.colUser}</dt>
                <dd dir="ltr">{selected.username || selected.user_id}</dd>
                <dt className="text-muted-foreground">{t.colAmount}</dt>
                <dd>{formatOrderAmount(selected.final_amount ?? selected.amount, data.currency, lang)}</dd>
                <dt className="text-muted-foreground">{t.colMethod}</dt>
                <dd>{selected.method || "—"}</dd>
                <dt className="text-muted-foreground">{t.colDate}</dt>
                <dd dir="ltr">{String(selected.created_at ?? "").slice(0, 16).replace("T", " ") || "—"}</dd>
                <dt className="text-muted-foreground">{t.colStatus}</dt>
                <dd>{statusBadge(selected.status ?? "pending")}</dd>
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

              <div className="space-y-1.5">
                <Label htmlFor="order-reason">{t.reasonLabel}</Label>
                <Textarea id="order-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                <p className="text-xs text-muted-foreground">{t.reasonHint}</p>
              </div>
            </div>
          )}

          <DialogFooter className="flex-wrap gap-2">
            <Button
              disabled={setStatusMutation.isPending}
              onClick={() => selected && setStatusMutation.mutate({ orderId: selected.order_id, next: "verified", why: reason })}
            >
              <Check className="me-1.5 size-4" /> {t.approve}
            </Button>
            <Button
              variant="outline"
              disabled={setStatusMutation.isPending}
              onClick={() => selected && setStatusMutation.mutate({ orderId: selected.order_id, next: "postponed", why: reason })}
            >
              <Clock className="me-1.5 size-4" /> {t.postpone}
            </Button>
            <Button
              variant="destructive"
              disabled={setStatusMutation.isPending || !reason.trim()}
              title={!reason.trim() ? t.reasonRequired : undefined}
              onClick={() => selected && setStatusMutation.mutate({ orderId: selected.order_id, next: "rejected", why: reason })}
            >
              <X className="me-1.5 size-4" /> {t.reject}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
