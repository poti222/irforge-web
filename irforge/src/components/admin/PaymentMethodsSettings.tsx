/**
 * PaymentMethodsSettings.tsx — «اینجا بگو پول را کجا بفرستند».
 *
 * سایت تا امروز هیچ‌جایی برای وارد کردن **آدرس کیف پول رمزارز** و **شماره
 * کارت مقصد** نداشت؛ صفحه‌ی کیف پول از کاربر هش تراکنش می‌خواست بدون اینکه
 * بگوید تتر را به کدام آدرس بفرستد. این فرم همان جای خالی است: سوپرادمین
 * اینجا پرشان می‌کند و کاربر در تب‌های «کارت» و «USDT» صفحه‌ی کیف پول
 * می‌بیندشان.
 *
 * مقدارها در جدول `platform_settings` (کلید `payment_methods`) ذخیره می‌شوند
 * و اگر خالی باشند، سرور به متغیرهای محیطی برمی‌گردد — ببینید
 * api-server/src/lib/platformSettings.ts.
 */
import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Bitcoin, CreditCard, Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";

export type PaymentMethods = {
  usdt: { address: string; network: string; memo: string; tomanPerUsdt: number; note: string; enabled: boolean };
  card: { number: string; holder: string; bank: string; note: string; enabled: boolean };
};

export const PAYMENT_SETTINGS_KEY = ["admin-payment-settings"] as const;

const NETWORKS = ["TRC20", "ERC20", "BEP20", "TON", "SOL"];

export function PaymentMethodsSettings() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: PAYMENT_SETTINGS_KEY,
    queryFn: () => customFetch<PaymentMethods>("/api/admin/payment-settings"),
  });

  // پیش‌نویس محلی — تا وقتی «ذخیره» نزده‌اند چیزی به سرور نمی‌رود.
  const [draft, setDraft] = useState<PaymentMethods | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setDraft(data); }, [data]);

  if (!draft) {
    return <div className="h-64 animate-pulse rounded-md bg-muted" />;
  }

  function patchUsdt(patch: Partial<PaymentMethods["usdt"]>) {
    setDraft((d) => (d ? { ...d, usdt: { ...d.usdt, ...patch } } : d));
  }
  function patchCard(patch: Partial<PaymentMethods["card"]>) {
    setDraft((d) => (d ? { ...d, card: { ...d.card, ...patch } } : d));
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await customFetch<PaymentMethods>("/api/admin/payment-settings", {
        method: "PUT",
        body: JSON.stringify(draft),
      });
      setDraft(saved);
      queryClient.invalidateQueries({ queryKey: PAYMENT_SETTINGS_KEY });
      // کاربران دیگر آدرس تازه را در صفحه‌ی کیف پول ببینند.
      queryClient.invalidateQueries({ queryKey: ["wallet-deposit-info"] });
      toast({ title: fa ? "تنظیمات واریز ذخیره شد" : "Deposit settings saved" });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    } finally {
      setSaving(false);
    }
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(data);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{fa ? "اطلاعات واریز" : "Deposit details"}</CardTitle>
        <CardDescription>
          {fa
            ? "آدرس کیف پول رمزارز و شماره کارتی که کاربر باید پول را به آن بفرستد. این‌ها در صفحه‌ی «کیف پول» به کاربر نمایش داده می‌شوند."
            : "The crypto wallet address and card number users send funds to. Shown to users on the Wallet page."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* ─── رمزارز ─── */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Bitcoin className="size-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold">{fa ? "کیف پول رمزارز (USDT)" : "Crypto wallet (USDT)"}</h4>
            <div className="ms-auto flex items-center gap-2">
              <Label htmlFor="usdt-enabled" className="text-xs text-muted-foreground">{fa ? "فعال" : "Enabled"}</Label>
              <Switch id="usdt-enabled" checked={draft.usdt.enabled} onCheckedChange={(v) => patchUsdt({ enabled: v })} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="usdt-address">{fa ? "آدرس کیف پول مقصد" : "Destination wallet address"}</Label>
            <Input
              id="usdt-address" dir="ltr" className="font-mono text-xs"
              placeholder="TXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              value={draft.usdt.address}
              onChange={(e) => patchUsdt({ address: e.target.value })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="usdt-network">{fa ? "شبکه" : "Network"}</Label>
              {/* لیست باز است نه بسته: شبکه‌ی جدید نباید نیازمند دیپلوی باشد. */}
              <Input
                id="usdt-network" dir="ltr" list="usdt-networks"
                value={draft.usdt.network}
                onChange={(e) => patchUsdt({ network: e.target.value })}
              />
              <datalist id="usdt-networks">
                {NETWORKS.map((n) => <option key={n} value={n} />)}
              </datalist>
              <p className="text-xs text-muted-foreground">
                {fa ? "همین متن با هشدار به کاربر نشان داده می‌شود." : "Shown to the user as a warning label."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="usdt-memo">{fa ? "Memo / Tag (اختیاری)" : "Memo / Tag (optional)"}</Label>
              <Input id="usdt-memo" dir="ltr" value={draft.usdt.memo} onChange={(e) => patchUsdt({ memo: e.target.value })} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="usdt-rate">{fa ? "نرخ هر تتر (تومان)" : "Rate per USDT (Toman)"}</Label>
              <Input
                id="usdt-rate" type="number" dir="ltr"
                value={draft.usdt.tomanPerUsdt || ""}
                onChange={(e) => patchUsdt({ tomanPerUsdt: Number(e.target.value) || 0 })}
              />
              <p className="text-xs text-muted-foreground">{fa ? "صفر یعنی نمایش نده." : "Zero hides it."}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="usdt-note">{fa ? "توضیح زیر آدرس" : "Note under the address"}</Label>
              <Input id="usdt-note" value={draft.usdt.note} onChange={(e) => patchUsdt({ note: e.target.value })} />
            </div>
          </div>
        </section>

        {/* ─── کارت به کارت ─── */}
        <section className="space-y-3 border-t pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <CreditCard className="size-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold">{fa ? "کارت به کارت" : "Card transfer"}</h4>
            <div className="ms-auto flex items-center gap-2">
              <Label htmlFor="card-enabled" className="text-xs text-muted-foreground">{fa ? "فعال" : "Enabled"}</Label>
              <Switch id="card-enabled" checked={draft.card.enabled} onCheckedChange={(v) => patchCard({ enabled: v })} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="card-number">{fa ? "شماره کارت" : "Card number"}</Label>
              <Input
                id="card-number" dir="ltr" inputMode="numeric" className="font-mono"
                placeholder="6037-XXXX-XXXX-XXXX"
                value={draft.card.number}
                onChange={(e) => patchCard({ number: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="card-holder">{fa ? "به نام" : "Card holder"}</Label>
              <Input id="card-holder" value={draft.card.holder} onChange={(e) => patchCard({ holder: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="card-bank">{fa ? "بانک" : "Bank"}</Label>
              <Input id="card-bank" value={draft.card.bank} onChange={(e) => patchCard({ bank: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="card-note">{fa ? "توضیح" : "Note"}</Label>
              <Input id="card-note" value={draft.card.note} onChange={(e) => patchCard({ note: e.target.value })} />
            </div>
          </div>
        </section>

        <Button onClick={save} disabled={saving || !dirty}>
          {saving ? <Loader2 className="me-2 size-4 animate-spin" /> : <Save className="me-2 size-4" />}
          {fa ? "ذخیره" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
