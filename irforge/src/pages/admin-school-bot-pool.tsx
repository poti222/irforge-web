import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Bot, Plus, CheckCircle2, Trash2, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/ui/refresh-button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";
import { listSchoolBotPool, addSchoolBotPoolToken, deleteSchoolBotPoolToken, type SchoolBotPoolEntry } from "@/lib/schools-api";

/**
 * pages/admin-school-bot-pool.tsx — بخش "/schools" فاز ۷ (بخش A): پنلِ
 * سوپرادمینِ پلتفرم برایِ افزودنِ توکنِ باتِ تلگرامی به استخر — دقیقاً همان
 * الگویِ pages/admin-sheet-pool.tsx (سطحِ پلتفرم، نه پنلِ مدیرِ یک مدرسه).
 * هر توکن با خریدِ «بات اطلاع‌رسانی» یک مدرسه مصرف می‌شود (routes/
 * schoolBots.ts). توکنِ خام هرگز نمایش داده نمی‌شود — فقط ۸ کاراکترِ آخر.
 */
export default function AdminSchoolBotPool() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const [newToken, setNewToken] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "school-bot-pool"],
    queryFn: listSchoolBotPool,
  });

  const available = data?.filter((s) => s.status === "available").length ?? 0;
  const assigned = data?.filter((s) => s.status === "assigned").length ?? 0;

  async function add() {
    const token = newToken.trim();
    if (!token) return;
    setAdding(true);
    try {
      await addSchoolBotPoolToken(token);
      toast({ title: fa ? "توکن اضافه شد" : "Token added" });
      setNewToken("");
      await refetch();
    } catch (e: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: e?.data?.error ?? e?.message });
    } finally {
      setAdding(false);
    }
  }

  async function removeEntry(entry: SchoolBotPoolEntry) {
    if (entry.status === "assigned") {
      toast({
        variant: "destructive",
        title: fa ? "قابل حذف نیست" : "Can't delete",
        description: fa ? "این توکن به یک مدرسه اختصاص داده شده." : "This token is assigned to a school.",
      });
      return;
    }
    if (confirmDeleteId !== entry.id) {
      setConfirmDeleteId(entry.id);
      return;
    }
    setBusyRow(entry.id);
    try {
      await deleteSchoolBotPoolToken(entry.id);
      toast({ title: fa ? "توکن حذف شد" : "Token deleted" });
      await refetch();
    } catch (e: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: e?.data?.error ?? e?.message });
    } finally {
      setBusyRow(null);
      setConfirmDeleteId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Bot className="size-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{fa ? "استخر بات مدرسه" : "School Bot Pool"}</h1>
          <p className="text-sm text-muted-foreground">
            {fa
              ? "توکن‌های بات تلگرامیِ آماده که با خریدِ «بات اطلاع‌رسانی» یک مدرسه مصرف می‌شوند."
              : "Ready Telegram bot tokens consumed when a school buys the notification bot add-on."}
          </p>
        </div>
        <RefreshButton className="ms-auto shrink-0" queryKeys={[["admin", "school-bot-pool"]]} label={fa ? "به‌روزرسانی" : "Refresh"} />
      </div>

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

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <Input
            value={newToken}
            onChange={(e) => setNewToken(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder={fa ? "توکن بات (از BotFather)" : "Bot token (from BotFather)"}
            className="flex-1 font-mono text-sm"
            dir="ltr"
          />
          <Button onClick={add} disabled={adding || !newToken.trim()}>
            {adding ? <Loader2 className="me-1.5 size-4 animate-spin" /> : <Plus className="me-1.5 size-4" />}
            {fa ? "افزودن توکن" : "Add token"}
          </Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Card key={i} className="animate-pulse"><CardContent className="h-14" /></Card>)}
        </div>
      ) : error ? (
        <Card className="border-destructive/40">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {fa ? "دریافت فهرست ممکن نشد. دسترسی سوپرادمین لازم است." : "Couldn't load the list. Super-admin access is required."}
          </CardContent>
        </Card>
      ) : !data || data.length === 0 ? (
        <div className="rounded-xl border border-dashed py-14 text-center">
          <Bot className="mx-auto mb-3 size-9 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {fa ? "هنوز توکنی توی استخر نیست. یکی از بالا اضافه کن." : "No tokens in the pool yet. Add one above."}
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
              <div className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs text-muted-foreground" dir="ltr">
                  …{s.fingerprint ?? "?"}
                </span>
                {s.status === "assigned" && s.assignedSchoolName && (
                  <span className="mt-0.5 block truncate text-xs font-medium text-foreground">{s.assignedSchoolName}</span>
                )}
              </div>
              {s.status === "available" ? (
                <Badge className="shrink-0 gap-1 bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400">
                  <CheckCircle2 className="size-3" />
                  {fa ? "آزاد" : "Available"}
                </Badge>
              ) : (
                <Badge variant="secondary" className="shrink-0">{fa ? "اختصاص‌یافته" : "Assigned"}</Badge>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="shrink-0 size-8 text-muted-foreground hover:text-destructive"
                aria-label={fa ? "حذف توکن" : "Delete token"}
                disabled={busyRow === s.id}
                onClick={() => removeEntry(s)}
              >
                {busyRow === s.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              </Button>
              {confirmDeleteId === s.id && (
                <span className="shrink-0 text-xs text-destructive">{fa ? "دوباره بزن برای حذف قطعی" : "Click again to confirm"}</span>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
