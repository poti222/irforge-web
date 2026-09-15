import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { ArrowLeftRight, Loader2, Database, Cloud } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshButton } from "@/components/ui/refresh-button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";

type CutoverRow = {
  entity: string;
  useDb: boolean;
  tenantOverrideCount: number;
  updatedAt: string | null;
};

export default function AdminCutoverFlags() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busyEntity, setBusyEntity] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "cutover-flags"],
    queryFn: () => customFetch<CutoverRow[]>("/api/superadmin/cutover-flags"),
  });

  const onPostgres = data?.filter((r) => r.useDb).length ?? 0;

  async function toggle(row: CutoverRow, next: boolean) {
    setBusyEntity(row.entity);
    // خوش‌بینانه: سوییچ فوراً جابه‌جا می‌شود، اگر سرور رد کرد برمی‌گردد.
    queryClient.setQueryData<CutoverRow[]>(["admin", "cutover-flags"], (old) =>
      old?.map((r) => (r.entity === row.entity ? { ...r, useDb: next } : r))
    );
    try {
      await customFetch(`/api/superadmin/cutover-flags/${row.entity}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: next }),
      });
      toast({
        title: next
          ? (fa ? `${row.entity} به Postgres مهاجرت کرد` : `${row.entity} switched to Postgres`)
          : (fa ? `${row.entity} به Sheets برگشت` : `${row.entity} switched back to Sheets`),
      });
      await refetch();
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: fa ? "خطا" : "Error",
        description: e?.message,
      });
      await refetch();
    } finally {
      setBusyEntity(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ArrowLeftRight className="size-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">
            {fa ? "پرچم‌های مهاجرت دیتابیس" : "Cutover Flags"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {fa
              ? "برای هر بخش، تعیین کن آیا خواندن/نوشتنِ همه‌ی بات‌ها از Postgres باشد یا هنوز از Google Sheets."
              : "For each entity, decide whether every bot reads/writes it through Postgres or still through Google Sheets."}
          </p>
        </div>
        <RefreshButton
          className="ms-auto shrink-0"
          queryKeys={[["admin", "cutover-flags"]]}
          label={fa ? "به‌روزرسانی" : "Refresh"}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{fa ? "کل" : "Total entities"}</p>
            <p className="text-2xl font-bold">{data?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">
              {fa ? "روی Postgres" : "On Postgres"}
            </p>
            <p className="text-2xl font-bold text-emerald-500">{onPostgres}</p>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600 dark:text-amber-400">
        {fa
          ? "⚠️ سوییچ‌کردن یک entity، بلافاصله رفتارِ خواندن/نوشتنِ همه‌ی تننت‌های همان entity را عوض می‌کند. بعد از هر سوییچ، لاگ زنده را زیرِ نظر بگیر."
          : "⚠️ Toggling an entity immediately changes read/write behavior for every tenant on that entity. Watch live logs after each switch."}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="h-12" />
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card className="border-destructive/40">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {fa ? "دریافت فهرست ممکن نشد. دسترسی سوپرادمین لازمه." : "Couldn't load the list. Super-admin access is required."}
          </CardContent>
        </Card>
      ) : !data || data.length === 0 ? (
        <div className="rounded-xl border border-dashed py-14 text-center">
          <ArrowLeftRight className="mx-auto mb-3 size-9 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {fa ? "هیچ entityای شناخته نشد." : "No entities found."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          {data.map((row, i) => (
            <motion.div
              key={row.entity}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.01 }}
              className="flex items-center gap-3 border-b p-3 last:border-b-0 hover:bg-muted/30"
              data-testid={`cutover-row-${row.entity}`}
            >
              <div className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs" dir="ltr">
                  {row.entity}
                </span>
                {row.tenantOverrideCount > 0 && (
                  <Badge variant="secondary" className="mt-1 gap-1 text-[10px]">
                    {fa
                      ? `${row.tenantOverrideCount} override تک‌تننتی`
                      : `${row.tenantOverrideCount} tenant override${row.tenantOverrideCount > 1 ? "s" : ""}`}
                  </Badge>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                {row.useDb ? <Database className="size-3.5 text-emerald-500" /> : <Cloud className="size-3.5" />}
                {row.useDb ? (fa ? "Postgres" : "Postgres") : (fa ? "Sheets" : "Sheets")}
              </div>
              {busyEntity === row.entity ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <Switch
                  checked={row.useDb}
                  onCheckedChange={(checked) => toggle(row, checked)}
                  disabled={busyEntity !== null}
                  aria-label={
                    fa ? `سوییچِ ${row.entity} به ${row.useDb ? "Sheets" : "Postgres"}` : `Switch ${row.entity} to ${row.useDb ? "Sheets" : "Postgres"}`
                  }
                  data-testid={`cutover-switch-${row.entity}`}
                />
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
