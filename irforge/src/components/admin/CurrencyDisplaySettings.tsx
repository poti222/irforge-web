/**
 * CurrencyDisplaySettings.tsx — IRFORGE_PROMPT_V3 Phase 39.
 * ─────────────────────────────────────────────────────────────────────────────
 * Super admin controls which extra currencies show as an "≈ X" line next to
 * Toman prices (plans, plugin marketplace). Toman itself stays the one real
 * billing currency everywhere — this list is purely a display convenience.
 *
 * Mirrors SupportLinksSettings.tsx's shape: same list-editing pattern
 * (add/remove/edit rows, one PUT on save), same `platform_settings`-backed
 * endpoint pair (api-server/src/routes/currencyDisplay.ts, key
 * `currency_display`). If left empty, the server auto-derives a USD rate from
 * the already-configured USDT payment-method rate, so an unconfigured site
 * isn't stuck at "Toman only" by accident.
 */
import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Loader2, Save, Coins } from "lucide-react";
import { AmountInput } from "@/components/ui/amount-input";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { CURRENCY_DISPLAY_QUERY_KEY, type CurrencyDisplaySettings, type CurrencyRate } from "@/config/currency";

export const ADMIN_CURRENCY_DISPLAY_KEY = ["admin-currency-display"] as const;

function draftId(): string {
  return `draft_${Math.random().toString(36).slice(2)}`;
}

type DraftRate = CurrencyRate & { _id: string };

export function CurrencyDisplaySettings() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ADMIN_CURRENCY_DISPLAY_KEY,
    queryFn: () => customFetch<CurrencyDisplaySettings>("/api/admin/currency-display"),
  });

  const [rows, setRows] = useState<DraftRate[] | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data) setRows(data.rates.map((r) => ({ ...r, _id: draftId() })));
  }, [data]);

  if (!rows) {
    return <div className="h-48 animate-pulse rounded-md bg-muted" />;
  }

  function patchRow(id: string, fields: Partial<CurrencyRate>) {
    setRows((prev) => prev && prev.map((r) => (r._id === id ? { ...r, ...fields } : r)));
  }

  function addRow() {
    setRows((prev) => (prev ?? []).concat([{ _id: draftId(), code: "", label: "", tomanPerUnit: 0 }]));
  }

  function removeRow(id: string) {
    setRows((prev) => prev && prev.filter((r) => r._id !== id));
  }

  async function save() {
    if (!rows) return;
    setSaving(true);
    try {
      const payload: CurrencyDisplaySettings = {
        rates: rows.map(({ _id, ...r }) => r),
      };
      const saved = await customFetch<CurrencyDisplaySettings>("/api/admin/currency-display", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setRows(saved.rates.map((r) => ({ ...r, _id: draftId() })));
      queryClient.invalidateQueries({ queryKey: ADMIN_CURRENCY_DISPLAY_KEY });
      // بازدیدکننده‌های فعلی سایت (سوییچر واحد پول در هدر، صفحه‌ی پلن‌ها، مارکت‌پلیس)
      queryClient.invalidateQueries({ queryKey: CURRENCY_DISPLAY_QUERY_KEY });
      toast({ title: fa ? "تنظیمات واحد پول ذخیره شد" : "Currency display settings saved" });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    } finally {
      setSaving(false);
    }
  }

  const dirty = data ? JSON.stringify(rows.map(({ _id, ...r }) => r)) !== JSON.stringify(data.rates) : false;
  const invalidRows = rows.some(
    (r) => !/^[A-Za-z]{2,5}$/.test(r.code.trim()) || !r.label.trim() || !(Number(r.tomanPerUnit) > 0)
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Coins className="size-4 text-muted-foreground" />
          {fa ? "واحدهای پول نمایشی" : "Display currencies"}
        </CardTitle>
        <CardDescription>
          {fa
            ? "تومان تنها واحد پولِ واقعیِ خرید و کیف پول باقی می‌ماند. این لیست فقط یک خط «≈ مبلغ» کنار قیمت‌های تومانی (پلن‌ها، پلاگین‌ها) نمایش می‌دهد — اگر خالی بماند، سایت خودش از نرخ تتر تنظیم‌شده در «روش‌های پرداخت» یک نرخ دلار حدس می‌زند."
            : "Toman stays the only real currency for purchases and the wallet. This list only adds an \"≈ amount\" line next to Toman prices (plans, plugins) — leave it empty and the site derives a USD rate from the USDT rate already set under Payment methods."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {rows.length === 0 && (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            {fa ? "نرخ سفارشی‌ای تعریف نشده — نرخ دلارِ خودکار (از تتر) استفاده می‌شود." : "No custom rate defined — the automatic USD rate (from USDT) is used."}
          </p>
        )}

        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row._id} className="flex items-start gap-2 rounded-lg border p-3">
              <div className="grid flex-1 gap-2 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor={`code-${row._id}`} className="text-xs">{fa ? "کد (مثلاً USD)" : "Code (e.g. USD)"}</Label>
                  <Input
                    id={`code-${row._id}`} dir="ltr" placeholder="USD" maxLength={5}
                    value={row.code}
                    onChange={(e) => patchRow(row._id, { code: e.target.value.toUpperCase() })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`label-${row._id}`} className="text-xs">{fa ? "برچسب" : "Label"}</Label>
                  <Input
                    id={`label-${row._id}`}
                    placeholder={fa ? "مثلاً «دلار آمریکا»" : "e.g. \"US Dollar\""}
                    value={row.label}
                    onChange={(e) => patchRow(row._id, { label: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`rate-${row._id}`} className="text-xs">{fa ? "تومان به ازای یک واحد" : "Toman per unit"}</Label>
                  <AmountInput
                    id={`rate-${row._id}`} placeholder="60000"
                    value={String(row.tomanPerUnit || "")}
                    onChange={(e) => patchRow(row._id, { tomanPerUnit: Number(e.target.value) })}
                  />
                </div>
              </div>
              <Button
                type="button" variant="ghost" size="icon"
                className="mt-5 shrink-0 text-destructive hover:text-destructive"
                onClick={() => removeRow(row._id)}
                aria-label={fa ? "حذف" : "Remove"}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>

        <Button type="button" variant="outline" size="sm" onClick={addRow} className="gap-1.5">
          <Plus className="size-3.5" /> {fa ? "افزودن واحد پول" : "Add currency"}
        </Button>

        {invalidRows && rows.length > 0 && (
          <p className="text-xs text-amber-500">
            {fa
              ? "ردیف‌های ناقص (کد نامعتبر، بدون برچسب، یا نرخ صفر/منفی) موقع ذخیره نادیده گرفته می‌شوند."
              : "Incomplete rows (invalid code, missing label, or a zero/negative rate) are dropped on save."}
          </p>
        )}

        <Button onClick={save} disabled={saving || !dirty}>
          {saving ? <Loader2 className="me-2 size-4 animate-spin" /> : <Save className="me-2 size-4" />}
          {fa ? "ذخیره" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
