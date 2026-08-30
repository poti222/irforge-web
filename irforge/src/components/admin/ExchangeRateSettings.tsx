/**
 * ExchangeRateSettings.tsx — Phase 10 of identityverificationspec.md.
 *
 * Shows the current USD→Rial rate (used to live-price any plan with a
 * `priceUsd` set, in the "Plans" tab below it), when it was last synced,
 * and lets a super admin override it manually. Deliberately separate from
 * CurrencyDisplaySettings (Phase 39) — that one edits a display-only "≈ X
 * USD" label; this one edits the rate a live-priced plan is actually
 * charged through.
 *
 * Standard/Pro (the account plans consolidated to match the bot-purchase
 * tiers) currently have a flat Toman price, not `priceUsd` — so this rate
 * has no live-priced plan to affect right now, but stays functional for
 * whenever an admin creates one with PlansManager.
 */
import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { getListPlansQueryKey } from "@workspace/api-client-react";

type ExchangeRate = {
  rialPerUsd: number;
  source: "api" | "manual";
  fetchedAt: string;
  stale: boolean;
} | null;

export const EXCHANGE_RATE_KEY = ["admin-exchange-rate"] as const;

export function ExchangeRateSettings() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: rate, isLoading } = useQuery({
    queryKey: EXCHANGE_RATE_KEY,
    queryFn: () => customFetch<ExchangeRate>("/api/admin/exchange-rate"),
  });

  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const rialPerUsd = Number(draft);
    if (!Number.isFinite(rialPerUsd) || rialPerUsd <= 0) {
      toast({ variant: "destructive", title: fa ? "نرخ نامعتبر است" : "Invalid rate" });
      return;
    }
    setSaving(true);
    try {
      await customFetch("/api/admin/exchange-rate", { method: "POST", body: JSON.stringify({ rialPerUsd }) });
      queryClient.invalidateQueries({ queryKey: EXCHANGE_RATE_KEY });
      // پلن‌های زنده‌قیمت (priceUsd) بلافاصله با نرخ تازه نشان داده شوند.
      queryClient.invalidateQueries({ queryKey: getListPlansQueryKey() });
      setDraft("");
      toast({ title: fa ? "نرخ ذخیره شد" : "Rate saved" });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return <div className="h-32 animate-pulse rounded-md bg-muted" />;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{fa ? "نرخ دلار به ریال" : "USD → Rial exchange rate"}</CardTitle>
        <CardDescription>
          {fa
            ? "همان نرخی که پلن‌های زنده‌قیمت (دلاری) با آن به تومان تبدیل می‌شوند. هر ساعت خودکار از Nobitex همگام می‌شود."
            : "The rate any live-priced (USD) plan converts through to Toman. Synced automatically from Nobitex every hour."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rate ? (
          <div className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">{fa ? "نرخ فعلی: " : "Current rate: "}</span>
              <span className="font-semibold">{rate.rialPerUsd.toLocaleString(fa ? "fa-IR" : "en-US")} {fa ? "ریال" : "Rial"}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {fa ? "منبع: " : "Source: "}{rate.source === "manual" ? (fa ? "دستی" : "manual") : (fa ? "خودکار" : "automatic")}
              {" — "}
              {new Date(rate.fetchedAt).toLocaleString(fa ? "fa-IR" : "en-US")}
            </p>
            {rate.stale && (
              <p className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-600">
                <AlertTriangle className="size-3.5 shrink-0" />
                {fa
                  ? "این نرخ کهنه است — همگام‌سازی خودکار موفق نبوده. تا بازیابی، یک نرخ دستی ثبت کنید."
                  : "This rate is stale — the automatic sync hasn't succeeded recently. Set a manual rate until it recovers."}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{fa ? "هنوز هیچ نرخی ثبت نشده." : "No rate has been recorded yet."}</p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="exchange-rate-override">{fa ? "نرخ دستی (ریال به ازای هر دلار)" : "Manual rate (Rial per USD)"}</Label>
            <AmountInput id="exchange-rate-override" value={draft} onChange={(e) => setDraft(e.target.value)} />
          </div>
          <Button onClick={save} disabled={saving || !draft}>
            {saving ? <Loader2 className="me-2 size-4 animate-spin" /> : <Save className="me-2 size-4" />}
            {fa ? "ذخیره" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
