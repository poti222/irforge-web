/**
 * PaymentsSection.tsx — پرداخت‌ها، کنار سفارش‌ها.
 * ─────────────────────────────────────────────────────────────────────────────
 * قبلاً «اطلاعات پرداخت» یک تب در تنظیمات عمومی بات بود — کنار زبان و ساعت
 * کاری. ولی پرداخت به همان دنیایی تعلق دارد که سفارش‌ها: باتی که فروش ندارد
 * نه سفارش دارد و نه اطلاعات پرداخت. حالا هر دو کنار هم و پشت **همان گیتِ
 * پلاگین کیف پول** هستند (`lib/pluginGate.ts`).
 *
 * ⚠️ `support_username` عمداً همراهش نیامد و به تب «عمومی» رفت: یوزرنیم
 * پشتیبانی ربطی به فروش ندارد و باتی بدون کیف پول هم به آن نیاز دارد.
 * پنهان‌کردنش پشت گیت فروش یعنی از دست دادن یک تنظیم کاملاً عادی.
 *
 * `orders-config` (دکمه‌های رسید/تأیید/رد) تا امروز **هیچ UI ای نداشت** —
 * endpointش بود و هیچ‌کس صدایش نمی‌زد. اینجا اولین جایی است که دیده می‌شود.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { Loader2, Save, CreditCard, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";

type SettingsEnvelope = { settings: { payment_info: string }; cacheBust: boolean };
type OrdersConfig = { config: Record<string, unknown>; keys: string[] };

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}

/** دکمه‌های یک مرحله — آرایه‌ای از `{text, url}` که بات زیر پیام می‌گذارد. */
type ConfigButton = { text: string; url: string };

function asButtons(raw: unknown): ConfigButton[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === "object")
    .map((b) => ({ text: String(b.text ?? ""), url: String(b.url ?? "") }));
}

function ButtonSetEditor({
  label,
  hint,
  buttons,
  onChange,
}: {
  label: string;
  hint: string;
  buttons: ConfigButton[];
  onChange: (next: ConfigButton[]) => void;
}) {
  const t = useT("botPayments");

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div>
        <Label>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>

      {buttons.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.noButtons}</p>
      ) : (
        buttons.map((button, i) => (
          <div key={i} className="flex flex-col gap-2 sm:flex-row">
            <Input
              className="sm:flex-1"
              placeholder={t.buttonText}
              value={button.text}
              onChange={(e) => onChange(buttons.map((b, j) => (j === i ? { ...b, text: e.target.value } : b)))}
            />
            <Input
              dir="ltr"
              className="sm:flex-1"
              placeholder="https://"
              value={button.url}
              onChange={(e) => onChange(buttons.map((b, j) => (j === i ? { ...b, url: e.target.value } : b)))}
            />
            <Button
              variant="ghost" size="icon" className="shrink-0"
              aria-label={t.removeButton}
              onClick={() => onChange(buttons.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </div>
        ))
      )}

      <Button variant="outline" size="sm" onClick={() => onChange([...buttons, { text: "", url: "" }])}>
        <Plus className="me-1.5 size-3.5" /> {t.addButton}
      </Button>
    </div>
  );
}

export function PaymentsSection({ bot }: { bot: Bot }) {
  const t = useT("botPayments");
  const { toast } = useToast();
  const qc = useQueryClient();

  const settingsKey = ["bot-settings", bot.id] as const;
  const { data: settings, isLoading, error } = useQuery({
    queryKey: settingsKey,
    queryFn: () => customFetch<SettingsEnvelope>(`/api/bots/${bot.id}/settings`),
  });

  const configKey = ["bot-orders-config", bot.id] as const;
  const { data: config, error: configError } = useQuery({
    queryKey: configKey,
    queryFn: () => customFetch<OrdersConfig>(`/api/bots/${bot.id}/orders-config`),
    retry: false,
  });

  const [paymentInfo, setPaymentInfo] = useState<string | null>(null);
  const [buttons, setButtons] = useState<Record<string, ConfigButton[]> | null>(null);

  const savePayment = useMutation({
    mutationFn: (value: string) =>
      customFetch(`/api/bots/${bot.id}/settings`, {
        method: "PATCH",
        body: JSON.stringify({ payment_info: value }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKey });
      setPaymentInfo(null);
      toast({ title: t.saved });
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const saveButtons = useMutation({
    mutationFn: (next: Record<string, ConfigButton[]>) =>
      customFetch(`/api/bots/${bot.id}/orders-config`, {
        method: "PATCH",
        // دکمه‌های بی‌متن دور ریخته می‌شوند: یک دکمه‌ی بدون برچسب در تلگرام
        // اصلاً رندر نمی‌شود و فقط ردیف را خراب می‌کند.
        body: JSON.stringify(
          Object.fromEntries(
            Object.entries(next).map(([k, v]) => [k, v.filter((b) => b.text.trim())]),
          ),
        ),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: configKey });
      setButtons(null);
      toast({ title: t.saved });
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t.loading}
      </div>
    );
  }

  if (error || !settings) {
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

  const infoValue = paymentInfo ?? settings.settings.payment_info;
  const infoDirty = paymentInfo !== null && paymentInfo !== settings.settings.payment_info;

  const currentButtons =
    buttons ??
    Object.fromEntries((config?.keys ?? []).map((k) => [k, asButtons(config?.config?.[k])]));
  const buttonsDirty = buttons !== null;

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="size-4" /> {t.paymentInfoTitle}
          </CardTitle>
          <CardDescription>{t.paymentInfoDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pay-info">{t.paymentInfo}</Label>
            <Textarea
              id="pay-info"
              rows={5}
              value={infoValue}
              onChange={(e) => setPaymentInfo(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t.paymentInfoHint}</p>
          </div>
          <Button disabled={!infoDirty || savePayment.isPending} onClick={() => savePayment.mutate(infoValue)}>
            {savePayment.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <Save className="me-2 size-4" />}
            {t.save}
          </Button>
        </CardContent>
      </Card>

      {config && (
        <Card>
          <CardHeader>
            <CardTitle>{t.orderButtonsTitle}</CardTitle>
            <CardDescription>{t.orderButtonsDesc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {config.keys.map((key) => (
              <ButtonSetEditor
                key={key}
                label={(t[`buttons_${key}` as keyof typeof t] as string) ?? key}
                hint={(t[`buttonsHint_${key}` as keyof typeof t] as string) ?? ""}
                buttons={currentButtons[key] ?? []}
                onChange={(next) => setButtons({ ...currentButtons, [key]: next })}
              />
            ))}
            <Button disabled={!buttonsDirty || saveButtons.isPending} onClick={() => saveButtons.mutate(currentButtons)}>
              {saveButtons.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <Save className="me-2 size-4" />}
              {t.save}
            </Button>
          </CardContent>
        </Card>
      )}

      {configError && (
        <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          {errMessage(configError, t.errorGeneric)}
        </p>
      )}
    </div>
  );
}
