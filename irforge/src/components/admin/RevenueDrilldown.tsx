/**
 * RevenueDrilldown.tsx — IRFORGE_PROMPT_V3 Phase 35.
 *
 * The number on a revenue card used to be a dead end: an admin curious
 * "which sales made up this 4.2M Toman?" had no way to find out short of a
 * database query. This dialog is what a click on any revenue card or
 * monthly-chart bar now opens — the itemized list behind `GET
 * /admin/revenue-details` (see routes/admin.ts), scoped by `kind` and/or
 * `month` to match whatever was clicked.
 */
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Spinner } from "@/components/ui/spinner";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";

export type RevenueKind = "bot" | "plugin" | "other";

export type RevenueDrilldownFilter = {
  kind?: RevenueKind;
  /** `YYYY-MM`, matching the `key` field on each `revenueByMonth` entry. */
  month?: string;
  title: string;
} | null;

type RevenueEntry = {
  id: string;
  amount: number;
  at: string;
  kind: RevenueKind;
  source: "payment" | "wallet";
  userName: string | null;
  userEmail: string | null;
  botName: string | null;
  note: string | null;
};

type RevenueDetails = {
  total: number;
  count: number;
  truncated: boolean;
  entries: RevenueEntry[];
};

const KIND_LABEL: Record<RevenueKind, { fa: string; en: string }> = {
  bot: { fa: "بات", en: "Bot" },
  plugin: { fa: "پلاگین", en: "Plugin" },
  other: { fa: "سایر", en: "Other" },
};

function entryDescription(e: RevenueEntry, fa: boolean): string {
  if (e.botName) return e.botName;
  if (e.note) return e.note;
  return fa ? "—" : "—";
}

export function RevenueDrilldown({ filter, onClose }: { filter: RevenueDrilldownFilter; onClose: () => void }) {
  const { lang } = useLanguage();
  const fa = lang === "fa";

  const params = new URLSearchParams();
  if (filter?.kind) params.set("kind", filter.kind);
  if (filter?.month) params.set("month", filter.month);
  const qs = params.toString();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-revenue-details", filter?.kind ?? null, filter?.month ?? null],
    queryFn: () => customFetch<RevenueDetails>(`/api/admin/revenue-details${qs ? `?${qs}` : ""}`),
    enabled: !!filter,
  });

  return (
    <Dialog open={!!filter} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{filter?.title}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Spinner size="sm" /> {fa ? "در حال بارگذاری…" : "Loading…"}
          </div>
        ) : !data || data.entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {fa ? "تراکنشی در این بازه یافت نشد." : "No transactions found for this filter."}
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {fa
                ? `مجموع ${formatToman(data.total, lang)} · ${data.count.toLocaleString("fa-IR")} تراکنش`
                : `Total ${formatToman(data.total, lang)} · ${data.count.toLocaleString("en-US")} transaction(s)`}
            </p>
            <div className="max-h-96 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{fa ? "تاریخ" : "Date"}</TableHead>
                    <TableHead>{fa ? "کاربر" : "User"}</TableHead>
                    <TableHead>{fa ? "شرح" : "Description"}</TableHead>
                    <TableHead>{fa ? "دسته" : "Kind"}</TableHead>
                    <TableHead className="text-end">{fa ? "مبلغ" : "Amount"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.entries.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(e.at).toLocaleDateString(fa ? "fa-IR" : "en-US")}
                      </TableCell>
                      <TableCell className="max-w-[10rem] truncate text-sm">{e.userName ?? e.userEmail ?? "—"}</TableCell>
                      <TableCell className="max-w-[12rem] truncate text-sm text-muted-foreground">{entryDescription(e, fa)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fa ? KIND_LABEL[e.kind].fa : KIND_LABEL[e.kind].en}</TableCell>
                      <TableCell className="text-end text-sm font-medium tabular-nums">{formatToman(e.amount, lang)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {data.truncated && (
              <p className="text-xs text-muted-foreground">
                {fa ? "فقط ۲۰۰ موردِ اخیر نشان داده می‌شود." : "Showing only the most recent 200 transactions."}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
