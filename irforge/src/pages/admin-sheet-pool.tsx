import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import {
  Database,
  Plus,
  ExternalLink,
  Loader2,
  CheckCircle2,
  LinkIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";

type SheetEntry = {
  id: string;
  sheetId: string;
  status: string;
  assignedBotId: string | null;
  createdAt: string;
};

const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}`;

export default function AdminSheetPool() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const [newSheet, setNewSheet] = useState("");
  const [adding, setAdding] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "sheet-pool"],
    queryFn: () => customFetch<SheetEntry[]>("/api/sheet-pool"),
  });

  const available = data?.filter((s) => s.status === "available").length ?? 0;
  const assigned = data?.filter((s) => s.status === "assigned").length ?? 0;

  async function add() {
    const id = newSheet.trim();
    if (!id) return;
    setAdding(true);
    try {
      await customFetch("/api/sheet-pool", { method: "POST", body: JSON.stringify({ sheetId: id }) });
      toast({ title: fa ? "شیت اضافه شد" : "Sheet added" });
      setNewSheet("");
      await refetch();
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: fa ? "خطا" : "Error",
        description: e?.status === 409
          ? (fa ? "این شیت قبلاً توی pool هست." : "This sheet is already in the pool.")
          : e?.message,
      });
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Database className="size-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{fa ? "استخر شیت" : "Sheet Pool"}</h1>
          <p className="text-sm text-muted-foreground">
            {fa ? "شیت‌های آماده که موقع تأیید پرداخت به بات‌ها اختصاص داده می‌شن." : "Ready sheets assigned to bots when a payment is approved."}
          </p>
        </div>
      </div>

      {/* counts */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: fa ? "کل" : "Total", value: data?.length ?? 0, tone: "text-foreground" },
          { label: fa ? "آزاد" : "Available", value: available, tone: "text-emerald-500" },
          { label: fa ? "اختصاص‌یافته" : "Assigned", value: assigned, tone: "text-amber-500" },
        ].map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className={`text-2xl font-bold ${c.tone}`}>{c.value.toLocaleString(fa ? "fa-IR" : "en-US")}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* add form */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <LinkIcon className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={newSheet}
              onChange={(e) => setNewSheet(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder={fa ? "Google Spreadsheet ID را وارد کن" : "Paste a Google Spreadsheet ID"}
              className="ps-9 font-mono text-sm"
              dir="ltr"
              data-testid="sheet-id-input"
            />
          </div>
          <Button onClick={add} disabled={adding || !newSheet.trim()} data-testid="add-sheet">
            {adding ? <Loader2 className="me-1.5 size-4 animate-spin" /> : <Plus className="me-1.5 size-4" />}
            {fa ? "افزودن شیت" : "Add sheet"}
          </Button>
        </CardContent>
      </Card>

      {/* list */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Card key={i} className="animate-pulse"><CardContent className="h-14" /></Card>)}
        </div>
      ) : error ? (
        <Card className="border-destructive/40">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {fa ? "دریافت فهرست ممکن نشد. دسترسی سوپرادمین لازمه." : "Couldn't load the list. Super-admin access is required."}
          </CardContent>
        </Card>
      ) : !data || data.length === 0 ? (
        <div className="rounded-xl border border-dashed py-14 text-center">
          <Database className="mx-auto mb-3 size-9 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {fa ? "هنوز شیتی توی pool نیست. یکی از بالا اضافه کن." : "No sheets in the pool yet. Add one above."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          {data.map((s, i) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.03 }}
              className="flex items-center gap-3 border-b p-3 last:border-b-0 hover:bg-muted/30"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" dir="ltr" title={s.sheetId}>
                {s.sheetId}
              </span>
              {s.status === "available" ? (
                <Badge className="ms-auto shrink-0 gap-1 bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400">
                  <CheckCircle2 className="size-3" />
                  {fa ? "آزاد" : "Available"}
                </Badge>
              ) : (
                <Badge variant="secondary" className="ms-auto shrink-0">
                  {fa ? "اختصاص‌یافته" : "Assigned"}
                </Badge>
              )}
              <a
                href={sheetUrl(s.sheetId)}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
                aria-label={fa ? "باز کردن شیت" : "Open sheet"}
              >
                <ExternalLink className="size-4" />
              </a>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
