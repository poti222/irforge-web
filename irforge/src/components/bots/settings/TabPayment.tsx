/**
 * TabPayment.tsx — تنظیماتِ پرداخت (کارت‌به‌کارت / درگاه آنلاین).
 * معادل `pay:admin_menu` در `handlers/payment.py`.
 *
 * فقط ۸ فیلدِ اولِ `payment_cfg` اینجا دست‌خورده‌اند؛ بقیه (`*_buttons`,
 * `*_image`, فیلدهای رسید) از سرور دست‌نخورده برمی‌گردند و روتِ PUT هم فقط
 * همین ۸ تا را روی مقدارِ فعلی merge می‌کند، نه بازنویسی کل — همان چیزی که
 * این کامپوننت هم باید رعایت کند و چیزی جز این ۸ فیلد در body نفرستد.
 */
import { useState } from "react";
import { CheckCircle2, CreditCard, Landmark, Loader2, Send, TriangleAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { SettingsSaveBar, SettingsError, CachePropagationNotice } from "./SettingsSaveBar";
import { useDraft } from "./useDraft";
import {
  useSavePaymentConfig,
  useTestOrderDelivery,
  type DeliveryResult,
  type OrderGroupCheck,
  type PaymentConfig,
  type SettingsEnvelope,
} from "./api";

/** نمایشِ گروه‌بندی‌شده‌ی ۴رقم‌۴رقم؛ ذخیره همیشه بدونِ فاصله انجام می‌شود. */
function formatCardNumber(digits: string): string {
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

function isValidCardNumber(digits: string): boolean {
  return digits === "" || digits.length === 16 || digits.length === 19;
}

function isValidGatewayUrl(url: string): boolean {
  if (url === "") return true;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export function TabPayment({ botId, data }: { botId: string; data: SettingsEnvelope }) {
  const t = useT("botSettings");
  const { toast } = useToast();
  const draft = useDraft<PaymentConfig & Record<string, unknown>>(
    `settings:payment:${botId}`,
    data.settings.payment_cfg as PaymentConfig & Record<string, unknown>
  );
  const save = useSavePaymentConfig(botId);
  const testDelivery = useTestOrderDelivery(botId);
  // نتیجه‌ی راستی‌آزمایی گروه بعد از آخرین ذخیره + نتیجه‌ی پیام آزمایشی.
  const [groupCheck, setGroupCheck] = useState<OrderGroupCheck | null>(null);
  const [testResults, setTestResults] = useState<DeliveryResult[] | null>(null);

  const cfg = draft.value as PaymentConfig;
  const cardNumberError = cfg.card_enabled && cfg.card_number === ""
    ? t.paymentCardNumberRequired
    : !isValidCardNumber(cfg.card_number)
      ? t.paymentCardNumberInvalid
      : null;
  const gatewayUrlError = isValidGatewayUrl(cfg.gateway_url) ? null : t.paymentGatewayUrlInvalid;

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="size-4" /> {t.paymentCardTitle}
          </CardTitle>
          <CardDescription>{t.paymentCardDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <Label htmlFor="pay-card-enabled">{t.paymentCardEnabled}</Label>
            <Switch
              id="pay-card-enabled"
              checked={cfg.card_enabled}
              onCheckedChange={(v) => draft.set("card_enabled", v)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-card-number">{t.paymentCardNumber}</Label>
            <Input
              id="pay-card-number" dir="ltr" inputMode="numeric"
              value={formatCardNumber(cfg.card_number)}
              onChange={(e) => draft.set("card_number", e.target.value.replace(/\D/g, ""))}
            />
            {cardNumberError && <p className="text-xs text-destructive">{cardNumberError}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-card-owner">{t.paymentCardOwner}</Label>
            <Input
              id="pay-card-owner"
              value={cfg.card_owner}
              onChange={(e) => draft.set("card_owner", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="size-4" /> {t.paymentGatewayTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <Label htmlFor="pay-gateway-enabled">{t.paymentGatewayEnabled}</Label>
            <Switch
              id="pay-gateway-enabled"
              checked={cfg.gateway_enabled}
              onCheckedChange={(v) => draft.set("gateway_enabled", v)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-gateway-url">{t.paymentGatewayUrl}</Label>
            <Input
              id="pay-gateway-url" dir="ltr"
              value={cfg.gateway_url}
              onChange={(e) => draft.set("gateway_url", e.target.value)}
            />
            {gatewayUrlError && <p className="text-xs text-destructive">{gatewayUrlError}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-gateway-label">{t.paymentGatewayLabel}</Label>
            <Input
              id="pay-gateway-label"
              value={cfg.gateway_label}
              onChange={(e) => draft.set("gateway_label", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4 rounded-md border p-3">
        <div className="space-y-1.5">
          <Label htmlFor="pay-order-group">{t.paymentOrderGroup}</Label>
          <Input
            id="pay-order-group" dir="ltr"
            value={cfg.order_group}
            onChange={(e) => {
              draft.set("order_group", e.target.value.trim());
              setGroupCheck(null);
              setTestResults(null);
            }}
          />
          <p className="text-xs text-muted-foreground">{t.paymentOrderGroupHint}</p>
          {groupCheck && groupCheck.status !== "unknown" && (
            <p
              className={`flex items-start gap-1.5 text-xs ${
                groupCheck.status === "ok" ? "text-emerald-600" : "text-destructive"
              }`}
            >
              {groupCheck.status === "ok" ? (
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
              ) : (
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              )}
              <span>
                {groupCheck.title ? `«${groupCheck.title}» — ` : ""}
                {groupCheck.message}
              </span>
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={testDelivery.isPending}
            onClick={() =>
              testDelivery.mutate(cfg.order_group, {
                onSuccess: (data) => setTestResults(data.results),
                onError: () => setTestResults(null),
              })
            }
          >
            {testDelivery.isPending ? (
              <Loader2 className="me-1.5 size-3.5 animate-spin" />
            ) : (
              <Send className="me-1.5 size-3.5" />
            )}
            {testDelivery.isPending ? t.paymentTestSending : t.paymentTestDelivery}
          </Button>
          {testDelivery.error && (
            <p className="text-xs text-destructive">
              {(testDelivery.error as any)?.data?.error ?? (testDelivery.error as Error).message}
            </p>
          )}
          {testResults && (
            <ul className="space-y-1.5 rounded-md border p-2 text-xs">
              {testResults.map((r, i) => (
                <li key={`${r.target}-${r.id}-${i}`} className="flex items-start gap-1.5">
                  {r.ok ? (
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                  ) : (
                    <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">
                      {r.target === "group" ? t.paymentTestTargetGroup : t.paymentTestTargetAdmin}
                      {r.label ? ` · ${r.label}` : ""}
                    </span>
                    {!r.ok && r.message ? <span className="block text-destructive">{r.message}</span> : null}
                    {!r.ok && r.suggestedChatId ? (
                      <button
                        type="button"
                        dir="ltr"
                        className="mt-1 block text-start text-primary underline"
                        onClick={() => {
                          draft.set("order_group", r.suggestedChatId as string);
                          setTestResults(null);
                        }}
                      >
                        {t.paymentTestUseSuggested}: {r.suggestedChatId}
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
              {!testResults.some((r) => r.target === "admin") && (
                <li className="text-muted-foreground">{t.paymentTestNoAdmins}</li>
              )}
              {testResults.every((r) => r.ok) && (
                <li className="font-medium text-emerald-600">{t.paymentTestAllOk}</li>
              )}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="pay-verify-required">{t.paymentVerifyRequired}</Label>
          <Switch
            id="pay-verify-required"
            checked={cfg.verify_required}
            onCheckedChange={(v) => draft.set("verify_required", v)}
          />
        </div>
      </div>

      <SettingsError error={save.error} />
      <CachePropagationNotice cacheBust={data.cacheBust} />
      <SettingsSaveBar
        dirty={draft.dirty}
        saving={save.isPending}
        disabled={Boolean(cardNumberError || gatewayUrlError)}
        onSave={() =>
          save.mutate(cfg, {
            onSuccess: (data) => {
              draft.markSaved();
              setGroupCheck(data.orderGroupCheck ?? null);
              setTestResults(null);
              toast({ title: t.saved });
            },
          })
        }
        onRevert={draft.reset}
      />
    </div>
  );
}
