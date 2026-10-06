/**
 * PlatformTopupPanel.tsx — تبِ «شارژ خودکار» کیف‌پولِ IrForge روی ماژولِ کارت‌به‌کارتِ خودکار (فاز ۸).
 *
 * جریان: کاربر مبلغ (پیش‌ست یا دلخواه، حداقل ۱۰۰٬۰۰۰ تومان) را انتخاب می‌کند ← سرور یک «مبلغِ نهاییِ یکتا» می‌سازد ←
 * کاربر **دقیقاً همان عدد** را به کارتِ مقصد (یا از لینکِ پرداخت) واریز می‌کند ← پیامکِ بانکِ گوشیِ صاحبِ سایت آن را تأیید می‌کند
 * و کیف‌پول فقط «مبلغِ خواسته‌شده» (نه پسوند) شارژ می‌شود. اگر تأییدِ خودکار نیامد: آپلودِ فیش → بررسیِ دستیِ ادمین.
 *
 * وضعیت‌ها: queued (صفِ لینکِ ثابت)، pending (شمارنده‌ی مهلت)، awaiting_review (فیش ثبت شد)، confirmed، expired/canceled/rejected.
 * درخواستِ فعال بعد از refresh هم برمی‌گردد (از `GET /api/wallet/topup`). هر ۴ ثانیه poll می‌شود.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Check, CheckCircle2, Clock, Copy, ExternalLink, Hourglass, Loader2, ReceiptText, Upload, Users, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AmountInput } from "@/components/ui/amount-input";
import { useToast } from "@/hooks/use-toast";
import { formatToman } from "@/lib/format";
import { toWebpDataUrl } from "@/lib/image";
import type { Lang } from "@/lib/i18n";

import { receiptReviewPhase } from "@/lib/topupCountdown";

export type TopupChannel = {
  id: string;
  kind: "card_manual" | "fixed_link" | "open_link";
  holderName: string | null;
  bankName: string | null;
  minAmountToman: number;
  cardLast4: string | null;
};
export type TopupConfig = { enabled: boolean; channels: TopupChannel[]; presets: number[]; min: number; max: number };
export type TopupStatus = "queued" | "pending" | "awaiting_review" | "confirmed" | "expired" | "canceled" | "rejected";
export type TopupOrder = {
  id: string;
  status: TopupStatus;
  requestedAmount: number;
  suffixRial: number;
  finalAmount: number;
  createdAt: string;
  expiresAt: string | null;
  confirmedAt: string | null;
  confirmedBy: "sms" | "admin" | null;
  queuedAhead: number | null;
  receiptUploadedAt: string | null;
  rejectReason: string | null;
  channel: { id: string; kind: string; holderName: string | null; bankName: string | null; description?: string | null; cardNumber: string | null; paymentUrl: string | null };
  existing?: boolean;
};

export const TOPUP_CONFIG_KEY = ["wallet-topup-config"] as const;
const ACTIVE: TopupStatus[] = ["queued", "pending", "awaiting_review"];

export function useTopupConfig() {
  return useQuery({
    queryKey: TOPUP_CONFIG_KEY,
    queryFn: () => customFetch<TopupConfig>("/api/wallet/topup/config"),
    staleTime: 60_000,
  });
}

const groupCard = (d: string) => d.replace(/(\d{4})(?=\d)/g, "$1 ");

function CopyField({ label, value, fa, display, testId }: { label: string; value: string; fa: boolean; display?: string; testId?: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ variant: "destructive", title: fa ? "کپی نشد — دستی انتخاب کنید" : "Copy failed — select manually" });
    }
  }
  return (
    <div className="space-y-1" data-testid={testId}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
        <code dir="ltr" className="min-w-0 flex-1 select-all break-all font-mono text-sm">{display ?? value}</code>
        <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" onClick={copy} aria-label={fa ? "کپی" : "Copy"}>
          {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
}

function useCountdown(expiresAt: string | null, active: boolean): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active, expiresAt]);
  return expiresAt ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000)) : null;
}

/** هر ثانیه tick می‌زند تا وقتی `active` است؛ برایِ شمارشگرِ ۵دقیقه‌ایِ بعد از فیش. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function channelLabel(c: TopupChannel, fa: boolean, i: number): string {
  const parts = [c.holderName, c.bankName, c.cardLast4 ? `····${c.cardLast4}` : ""].filter(Boolean);
  return parts.length ? parts.join(" — ") : `${fa ? "حساب" : "Account"} ${i + 1}`;
}

export function PlatformTopupPanel({ fa, lang }: { fa: boolean; lang: Lang }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: config } = useTopupConfig();
  const [amount, setAmount] = useState("");
  const [channelId, setChannelId] = useState<string | null>(null);
  const [order, setOrder] = useState<TopupOrder | null>(null);
  const [busy, setBusy] = useState<"request" | "cancel" | "receipt" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // بعد از refresh، درخواستِ فعالِ قبلی برمی‌گردد.
  const { data: recent } = useQuery({
    queryKey: ["wallet-topup-recent"],
    queryFn: () => customFetch<{ items: TopupOrder[] }>("/api/wallet/topup"),
    staleTime: 0,
  });
  useEffect(() => {
    if (order || !recent) return;
    const active = recent.items.find((o) => ACTIVE.includes(o.status));
    if (active) setOrder(active);
  }, [recent]);

  useEffect(() => {
    if (!channelId && config?.channels.length) setChannelId(config.channels[config.channels.length - 1].id);
  }, [config]);

  const isActive = order ? ACTIVE.includes(order.status) : false;
  const left = useCountdown(order?.expiresAt ?? null, order?.status === "pending");
  const reviewNow = useNow(order?.status === "awaiting_review");
  const review = order?.status === "awaiting_review" ? receiptReviewPhase(order.receiptUploadedAt, reviewNow) : null;

  // poll: تأییدِ خودکار (پیامک) یا ادمین همین‌جا دیده می‌شود.
  useEffect(() => {
    if (!order || !isActive) return;
    const t = setInterval(async () => {
      try {
        const fresh = await customFetch<TopupOrder>(`/api/wallet/topup/${order.id}/status`);
        setOrder(fresh);
        if (fresh.status === "confirmed") {
          toast({ title: fa ? "شارژ تأیید شد" : "Top-up confirmed", description: fa ? "موجودی شما اضافه شد." : "Your balance has been credited." });
          queryClient.invalidateQueries({ queryKey: ["wallet"] });
          queryClient.invalidateQueries({ queryKey: ["wallet-tx"] });
        } else if (fresh.status === "expired") {
          toast({ variant: "destructive", title: fa ? "مهلت پرداخت تمام شد" : "Payment window expired" });
        } else if (fresh.status === "rejected") {
          toast({ variant: "destructive", title: fa ? "فیش شما رد شد" : "Your receipt was rejected" });
        }
      } catch {
        // شکستِ موقتِ شبکه polling را قطع نمی‌کند.
      }
    }, 4000);
    return () => clearInterval(t);
  }, [order?.id, isActive]);

  const amountNum = Number(amount);
  const channel = config?.channels.find((c) => c.id === channelId) ?? config?.channels[0];
  const minToman = Math.max(config?.min ?? 100_000, channel?.minAmountToman ?? 0);
  const amountError = useMemo(() => {
    if (!amount) return null;
    if (!Number.isInteger(amountNum) || amountNum < minToman) {
      return fa ? `حداقل مبلغ ${formatToman(minToman, lang)} است.` : `Minimum is ${formatToman(minToman, lang)}.`;
    }
    if (config && amountNum > config.max) return fa ? `حداکثر ${formatToman(config.max, lang)}.` : `Maximum is ${formatToman(config.max, lang)}.`;
    return null;
  }, [amount, amountNum, minToman, config]);

  async function requestOrder() {
    if (!amount || amountError) { toast({ variant: "destructive", title: amountError ?? (fa ? "مبلغ نامعتبر" : "Invalid amount") }); return; }
    setBusy("request");
    try {
      const created = await customFetch<TopupOrder>("/api/wallet/topup/request", {
        method: "POST", body: JSON.stringify({ amount: amountNum, channelId }),
      });
      setOrder(created);
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    } finally {
      setBusy(null);
    }
  }

  async function cancelOrder() {
    if (!order) return;
    setBusy("cancel");
    try {
      await customFetch(`/api/wallet/topup/${order.id}/cancel`, { method: "POST" });
      reset();
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    } finally {
      setBusy(null);
    }
  }

  async function onReceipt(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !order) return;
    if (!file.type.startsWith("image/")) { toast({ variant: "destructive", title: fa ? "فقط تصویر" : "Image only" }); return; }
    setBusy("receipt");
    try {
      const receiptUrl = await toWebpDataUrl(file);
      const fresh = await customFetch<TopupOrder>(`/api/wallet/topup/${order.id}/receipt`, {
        method: "POST", body: JSON.stringify({ receiptUrl }),
      });
      setOrder(fresh);
      toast({ title: fa ? "فیش ثبت شد" : "Receipt submitted" });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "ثبت فیش ناموفق بود" : "Receipt failed", description: err?.message });
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    setOrder(null);
    setAmount("");
    queryClient.invalidateQueries({ queryKey: ["wallet-topup-recent"] });
  }

  if (!config) return <div className="h-40 animate-pulse rounded-md bg-muted" />;
  if (!config.enabled) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <span>{fa ? "شارژ خودکار فعلاً فعال نیست. از روش‌های دیگر استفاده کنید یا با پشتیبانی تماس بگیرید." : "Automatic top-up is not available right now. Use another method or contact support."}</span>
      </div>
    );
  }

  // ─── درخواستِ در جریان ────────────────────────────────────────────────────
  if (order) {
    const ch = order.channel;
    return (
      <div className="space-y-3 pt-3" data-testid="topup-order">
        {order.status === "queued" && (
          <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
              <Users className="size-4" /> {fa ? "در صفِ پرداخت هستید" : "You are in the payment queue"}
            </div>
            <p className="text-xs text-muted-foreground">
              {order.queuedAhead ? (fa ? `${order.queuedAhead} نفر با همین مبلغ جلوتر از شما هستند.` : `${order.queuedAhead} people with the same amount are ahead of you.`)
                : (fa ? "نفرِ بعدی شما هستید." : "You are next.")}{" "}
              {fa ? "وقتی نوبتتان برسد اطلاعات پرداخت همین‌جا نشان داده می‌شود؛ این صفحه را باز نگه دارید." : "When it's your turn the payment details appear here; keep this page open."}
            </p>
            <Button variant="outline" className="w-full" disabled={busy === "cancel"} onClick={cancelOrder}>
              {busy === "cancel" && <Loader2 className="me-2 size-4 animate-spin" />}{fa ? "انصراف" : "Cancel"}
            </Button>
          </div>
        )}

        {order.status === "pending" && (
          <div className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <Clock className="size-3.5 shrink-0" />
                {fa ? "منتظرِ واریز و تأییدِ خودکار" : "Waiting for payment & automatic confirmation"}
              </span>
              {left !== null && <span dir="ltr" className="rounded bg-background px-1.5 py-0.5 font-mono font-semibold" data-testid="topup-countdown">{mmss(left)}</span>}
            </div>

            {ch.cardNumber && (
              <div className="space-y-2">
                <CopyField label={fa ? "شماره کارت مقصد" : "Destination card"} value={ch.cardNumber} display={groupCard(ch.cardNumber)} fa={fa} testId="topup-card" />
                {(ch.holderName || ch.bankName) && (
                  <p className="text-xs text-muted-foreground">
                    {ch.holderName && <>{fa ? "به‌نام " : "Holder: "}<b>{ch.holderName}</b></>}
                    {ch.holderName && ch.bankName && " — "}
                    {ch.bankName && <>{fa ? "بانک " : "Bank: "}{ch.bankName}</>}
                  </p>
                )}
                {ch.description && <p className="whitespace-pre-line text-xs text-muted-foreground" data-testid="topup-description">{ch.description}</p>}
              </div>
            )}

            <div data-testid="topup-exact-amount">
              <CopyField
                label={fa ? "دقیقاً همین مبلغ را واریز کنید (ریال)" : "Pay exactly this amount (Rial)"}
                value={String(order.finalAmount)} display={order.finalAmount.toLocaleString("en-US")} fa={fa}
              />
            </div>
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive" data-testid="topup-warning">
              {order.suffixRial > 0
                ? (fa ? "حتی یک ریال کمتر یا بیشتر باعث می‌شود تأییدِ خودکار انجام نشود. این عدد با مبلغِ درخواستی فرق دارد چون یک پسوندِ کوچک برایِ تشخیصِ پرداختِ شما به آن اضافه شده؛ همان مبلغِ درخواستی به کیف‌پولتان اضافه می‌شود."
                  : "Even one Rial more or less prevents automatic confirmation. The number differs from your requested amount by a small suffix used to identify your payment; exactly the requested amount is credited.")
                : (fa ? "مبلغ را عیناً همین‌طور وارد کنید."
                  : "Enter the amount exactly as shown.")}
            </p>

            {ch.paymentUrl && (
              <Button asChild className="w-full">
                <a href={ch.paymentUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="me-2 size-4" /> {fa ? "رفتن به صفحه‌ی پرداخت" : "Open payment page"}
                </a>
              </Button>
            )}

            <div className="grid grid-cols-2 gap-2">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onReceipt} />
              <Button variant="outline" disabled={busy === "receipt"} onClick={() => fileRef.current?.click()} data-testid="topup-receipt-btn">
                {busy === "receipt" ? <Loader2 className="me-2 size-4 animate-spin" /> : <Upload className="me-2 size-4" />}
                {fa ? "ارسال فیش" : "Send receipt"}
              </Button>
              <Button variant="ghost" disabled={busy === "cancel"} onClick={cancelOrder}>
                {busy === "cancel" && <Loader2 className="me-2 size-4 animate-spin" />}{fa ? "انصراف" : "Cancel"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {fa ? "اگر پرداخت کردید و تأیید نیامد، تصویر فیش را بفرستید؛ سوپرادمین دستی بررسی می‌کند. (اگر پیامکِ بانک برسد همین‌جا خودکار تأیید می‌شود.) در صورتِ قطعیِ اینترنتِ گوشیِ دریافت‌کننده ممکن است تأییدِ خودکار با تأخیر انجام شود."
                : "If you paid and it isn't confirmed, send the receipt image; an admin will review it. (If the bank SMS arrives it confirms automatically.) If the receiving phone loses internet, automatic confirmation may be delayed."}
            </p>
          </div>
        )}

        {order.status === "awaiting_review" && (
          <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3" data-testid="topup-review">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ReceiptText className="size-4 text-primary" /> {fa ? "فیش ثبت شد" : "Receipt submitted"}
            </div>
            {review?.phase === "auto" ? (
              <div className="space-y-1.5" data-testid="topup-review-auto">
                <div className="flex items-center justify-between gap-2 text-xs text-amber-600 dark:text-amber-400">
                  <span className="flex items-center gap-1.5"><Hourglass className="size-3.5 shrink-0" />{fa ? "در حال بررسیِ خودکار…" : "Checking automatically…"}</span>
                  <span dir="ltr" className="rounded bg-background px-1.5 py-0.5 font-mono font-semibold" data-testid="topup-review-countdown">{mmss(review.secondsLeft)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {fa ? "اگر پیامکِ بانک برسد، پرداخت همین‌جا تأیید می‌شود. لازم نیست دوباره واریز کنید."
                    : "If the bank SMS arrives, the payment is confirmed right here. Do not pay again."}
                </p>
              </div>
            ) : (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="topup-review-manual">
                <Hourglass className="mt-0.5 size-3.5 shrink-0" />
                {fa ? "در حال بررسیِ دستی است. ادمین فیش را بررسی می‌کند و نتیجه همین‌جا اعلام می‌شود؛ اگر پیامکِ بانک برسد هم خودکار تأیید می‌شود. لازم نیست دوباره واریز کنید."
                  : "Manual review in progress. An admin is checking the receipt and the result appears here; it also confirms automatically if the bank SMS arrives. Do not pay again."}
              </p>
            )}
          </div>
        )}

        {order.status === "confirmed" && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400" data-testid="topup-confirmed">
            <CheckCircle2 className="size-4 shrink-0" />
            {fa ? `شارژِ ${formatToman(order.requestedAmount, lang)} تأیید شد.` : `Top-up of ${formatToman(order.requestedAmount, lang)} confirmed.`}
            <Button size="sm" variant="ghost" className="ms-auto" onClick={reset}>{fa ? "بستن" : "Close"}</Button>
          </div>
        )}

        {(order.status === "expired" || order.status === "canceled" || order.status === "rejected") && (
          <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <div className="flex items-center gap-2">
              <XCircle className="size-4 shrink-0" />
              {order.status === "expired" ? (fa ? "مهلتِ پرداخت تمام شد. اگر واریز کرده‌اید با پشتیبانی تماس بگیرید." : "The payment window expired. If you already paid, contact support.")
                : order.status === "rejected" ? (fa ? "فیش شما رد شد." : "Your receipt was rejected.")
                  : (fa ? "درخواست لغو شد." : "Request canceled.")}
              <Button size="sm" variant="ghost" className="ms-auto" onClick={reset}>{fa ? "تلاش مجدد" : "Try again"}</Button>
            </div>
            {order.status === "rejected" && order.rejectReason && <p className="text-xs">{fa ? "دلیل: " : "Reason: "}{order.rejectReason}</p>}
          </div>
        )}
      </div>
    );
  }

  // ─── انتخابِ مبلغ ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-3 pt-3" data-testid="topup-form">
      <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
        {fa ? "سریع‌ترین روش — تأیید خودکار با پیامکِ بانک و معمولاً در چند دقیقه." : "The fastest method — automatic confirmation by bank SMS, usually within minutes."}
      </p>
      {config.channels.length > 1 && (
        <div className="space-y-1.5">
          <Label>{fa ? "حساب مقصد" : "Destination account"}</Label>
          <div className="grid gap-1.5">
            {config.channels.map((c, i) => (
              <button key={c.id} type="button" onClick={() => setChannelId(c.id)}
                className={`rounded-md border px-3 py-2 text-start text-sm ${channelId === c.id ? "border-primary bg-primary/10" : "hover:bg-muted"}`}>
                {channelLabel(c, fa, i)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        <Label>{fa ? "مبلغ (تومان)" : "Amount (Toman)"}</Label>
        <div className="flex flex-wrap gap-1.5">
          {config.presets.map((p) => (
            <Button key={p} type="button" size="sm" variant={amount === String(p) ? "default" : "outline"} onClick={() => setAmount(String(p))}>
              {formatToman(p, lang)}
            </Button>
          ))}
        </div>
        <AmountInput value={amount} onChange={(e) => setAmount(e.target.value)} />
        <p className={`text-xs ${amountError ? "text-destructive" : "text-muted-foreground"}`}>
          {amountError ?? (fa ? `حداقل ${formatToman(minToman, lang)} — مبلغِ دلخواه هم می‌توانید بنویسید.` : `Minimum ${formatToman(minToman, lang)} — you can type a custom amount.`)}
        </p>
      </div>
      <Button onClick={requestOrder} disabled={busy === "request" || !amount || Boolean(amountError)} className="w-full">
        {busy === "request" && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{fa ? "ادامه" : "Continue"}
      </Button>
    </div>
  );
}
