/**
 * LoyaltySection.tsx — باشگاه مشتریان: تنظیمات اقتصاد + سطح‌ها/حساب‌ها (فاز ۲۴).
 *
 * تا امروز این چهار عدد (هر چند تومان = یک امتیاز، جایزه‌ی ثبت‌نام، ارزشِ
 * تبدیل امتیاز، حداقلِ تبدیل) فقط از داخل بات با دکمه‌های اینلاین قابل
 * تنظیم بودند (plugins/loyalty/handlers.py::cb_settings). سکشنِ سایت فقط
 * سطح‌ها و حساب‌ها را نشان می‌داد — این کارت همان جای خالی را پر می‌کند و
 * جدول‌های سطح/حساب (سیستم عمومیِ pluginCollections) را دست‌نخورده زیرش
 * نگه می‌دارد.
 */
import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Bot } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save, Star } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { PluginSection } from "@/components/bots/plugins/PluginSection";

type LoyaltySettings = {
  currencyPerPoint: number;
  signupBonus: number;
  redeemValue: number;
  redeemMinPoints: number;
};

function loyaltySettingsKey(botId: string) {
  return ["loyalty-settings", botId] as const;
}

function LoyaltySettingsCard({ bot }: { bot: Bot }) {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const qc = useQueryClient();

  const key = loyaltySettingsKey(bot.id);
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => customFetch<LoyaltySettings>(`/api/bots/${bot.id}/loyalty-settings`),
  });

  const [draft, setDraft] = useState<LoyaltySettings | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setDraft(data); }, [data]);

  if (!draft) {
    return <div className="h-40 animate-pulse rounded-md bg-muted" />;
  }

  function patch(fields: Partial<LoyaltySettings>) {
    setDraft((d) => (d ? { ...d, ...fields } : d));
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await customFetch<LoyaltySettings>(`/api/bots/${bot.id}/loyalty-settings`, {
        method: "PUT",
        body: JSON.stringify(draft),
      });
      setDraft(saved);
      qc.invalidateQueries({ queryKey: key });
      toast({ title: fa ? "تنظیمات باشگاه مشتریان ذخیره شد" : "Loyalty settings saved" });
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
        <CardTitle className="flex items-center gap-2 text-base">
          <Star className="size-4 text-muted-foreground" />
          {fa ? "اقتصادِ باشگاه مشتریان" : "Loyalty economics"}
        </CardTitle>
        <CardDescription>
          {fa
            ? "همان چهار عددی که قبلاً فقط از داخل بات قابل تنظیم بودند."
            : "The same four numbers that used to be settable only from inside the bot."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ly-currency-per-point">
              {fa ? "هر چند تومان = ۱ امتیاز" : "Currency per point"}
            </Label>
            <Input
              id="ly-currency-per-point" type="number" min={1} dir="ltr"
              value={draft.currencyPerPoint}
              onChange={(e) => patch({ currencyPerPoint: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ly-signup-bonus">{fa ? "جایزه‌ی ثبت‌نام (امتیاز)" : "Signup bonus (points)"}</Label>
            <Input
              id="ly-signup-bonus" type="number" min={0} dir="ltr"
              value={draft.signupBonus}
              onChange={(e) => patch({ signupBonus: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ly-redeem-value">
              {fa ? "ارزش هر امتیاز موقع تبدیل (تومان)" : "Redeem value per point"}
            </Label>
            <Input
              id="ly-redeem-value" type="number" min={0} dir="ltr"
              value={draft.redeemValue}
              onChange={(e) => patch({ redeemValue: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ly-redeem-min">{fa ? "حداقل امتیازِ قابل‌تبدیل" : "Minimum points to redeem"}</Label>
            <Input
              id="ly-redeem-min" type="number" min={0} dir="ltr"
              value={draft.redeemMinPoints}
              onChange={(e) => patch({ redeemMinPoints: Number(e.target.value) || 0 })}
            />
          </div>
        </div>
        <Button onClick={save} disabled={saving || !dirty}>
          {saving ? <Loader2 className="me-2 size-4 animate-spin" /> : <Save className="me-2 size-4" />}
          {fa ? "ذخیره" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

export function LoyaltySection({ bot }: { bot: Bot }) {
  return (
    <div className="space-y-4">
      <LoyaltySettingsCard bot={bot} />
      <PluginSection bot={bot} plugin="loyalty" />
    </div>
  );
}
