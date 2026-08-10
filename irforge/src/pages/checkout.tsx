import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  customFetch, getListBotsQueryKey, getListBotPluginsQueryKey, getGetBotQueryKey,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GlowButton } from "@/components/ui/glow-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  ShoppingCart, Trash2, Blocks, Bot as BotIcon, Wallet, Loader2, ArrowLeft, ArrowRight,
  Tag, X,
} from "lucide-react";
import { useCart, CartBot } from "@/contexts/CartContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";

const REQUIRED_BOT_FIELDS: (keyof Pick<CartBot, "phone" | "telegramId" | "name" | "token" | "description">)[] = [
  "phone", "telegramId", "name", "token", "description",
];

function isBotItemComplete(item: CartBot) {
  return REQUIRED_BOT_FIELDS.every((f) => item[f]?.trim());
}

type DiscountReason = "not_found" | "inactive" | "expired" | "exhausted";

type AppliedDiscount = {
  code: string;
  kind: "percent" | "fixed";
  value: number;
  discountAmount: number;
  finalAmount: number;
};

function discountReasonText(reason: string | undefined, fa: boolean): string {
  const messages: Record<DiscountReason, { fa: string; en: string }> = {
    not_found: { fa: "کد تخفیف پیدا نشد", en: "Discount code not found" },
    inactive: { fa: "این کد تخفیف غیرفعال است", en: "This discount code is inactive" },
    expired: { fa: "این کد تخفیف منقضی شده است", en: "This discount code has expired" },
    exhausted: { fa: "سقف استفاده از این کد تخفیف پر شده است", en: "This discount code has reached its usage limit" },
  };
  const entry = reason && reason in messages ? messages[reason as DiscountReason] : null;
  if (!entry) return fa ? "کد تخفیف نامعتبر است" : "Invalid discount code";
  return fa ? entry.fa : entry.en;
}

export default function Checkout() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { items, total, remove, clear, updateBot } = useCart();

  const [busy, setBusy] = useState(false);
  const [discountInput, setDiscountInput] = useState("");
  const [discountBusy, setDiscountBusy] = useState(false);
  const [discountErrorMsg, setDiscountErrorMsg] = useState<string | null>(null);
  const [appliedDiscount, setAppliedDiscount] = useState<AppliedDiscount | null>(null);

  const BackArrow = fa ? ArrowRight : ArrowLeft;

  const { data: wallet } = useQuery({
    queryKey: ["wallet"],
    queryFn: () => customFetch<{ balance: number }>("/api/wallet"),
  });
  const balance = wallet?.balance ?? 0;

  // Prefill bot-item contact fields from the user's profile once, without
  // overwriting anything the person has already typed.
  useEffect(() => {
    if (!user?.telegramId) return;
    items.forEach((item) => {
      if (item.kind === "bot" && !item.telegramId) {
        updateBot(item.key, { telegramId: user.telegramId as string });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.telegramId]);

  const botItems = items.filter((i): i is CartBot => i.kind === "bot");
  const allBotsComplete = botItems.every(isBotItemComplete);

  const tokenCounts = new Map<string, number>();
  botItems.forEach((i) => {
    const t = i.token.trim();
    if (t) tokenCounts.set(t, (tokenCounts.get(t) ?? 0) + 1);
  });
  const hasDuplicateTokens = botItems.some((i) => (tokenCounts.get(i.token.trim()) ?? 0) > 1);

  const canPay = items.length > 0 && allBotsComplete && !hasDuplicateTokens;

  const hasBotItems = botItems.length > 0;
  const payableTotal = appliedDiscount ? appliedDiscount.finalAmount : total;

  // The applied discount was quoted against a specific cart total — if the cart
  // changes (an item removed, a plugin added) after applying, that quote is
  // stale. Drop it rather than silently keep showing a wrong final amount.
  useEffect(() => {
    if (appliedDiscount && appliedDiscount.discountAmount + appliedDiscount.finalAmount !== total) {
      setAppliedDiscount(null);
      setDiscountErrorMsg(fa ? "سبد خرید تغییر کرد؛ کد تخفیف دوباره اعمال شود." : "Your cart changed; re-apply the discount code.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  async function applyDiscount() {
    const code = discountInput.trim();
    if (!code) return;
    setDiscountBusy(true);
    setDiscountErrorMsg(null);
    try {
      const result = await customFetch<{ valid: boolean; kind: "percent" | "fixed"; value: number; discountAmount: number; finalAmount: number }>(
        "/api/discounts/validate",
        { method: "POST", body: JSON.stringify({ code, amount: total }) }
      );
      setAppliedDiscount({
        code: code.toUpperCase(),
        kind: result.kind,
        value: result.value,
        discountAmount: result.discountAmount,
        finalAmount: result.finalAmount,
      });
    } catch (err: any) {
      setAppliedDiscount(null);
      setDiscountErrorMsg(discountReasonText(err?.data?.reason, fa));
    } finally {
      setDiscountBusy(false);
    }
  }

  function removeDiscount() {
    setAppliedDiscount(null);
    setDiscountInput("");
    setDiscountErrorMsg(null);
  }

  async function checkout() {
    if (!canPay) return;
    if (balance < payableTotal) {
      toast({
        variant: "destructive",
        title: fa ? "موجودی کیف پول کافی نیست" : "Insufficient wallet balance",
        description: fa ? "ابتدا کیف پول را شارژ کنید." : "Top up your wallet first.",
      });
      setLocation("/wallet");
      return;
    }
    setBusy(true);
    const touchedBots = new Set<string>();
    // The discount, if any, is only sent with the first bot purchase in the cart —
    // the server re-validates and applies it once, atomically, inside that request's
    // transaction. It isn't split across multiple items or sent to plugin purchases.
    let discountCodeToSend = appliedDiscount?.code ?? null;
    try {
      for (const item of items) {
        if (item.kind === "plugin") {
          await customFetch(`/api/bots/${item.botId}/plugins`, {
            method: "POST",
            body: JSON.stringify({ marketplaceItemId: item.marketplaceItemId, payFromWallet: true }),
          });
          touchedBots.add(item.botId);
        } else {
          await customFetch("/api/bots/wallet-purchase", {
            method: "POST",
            body: JSON.stringify({
              name: item.name,
              token: item.token,
              description: item.description,
              amount: item.price,
              phone: item.phone,
              telegramId: item.telegramId,
              discountCode: discountCodeToSend,
            }),
          });
          discountCodeToSend = null; // applied once
        }
        remove(item.key); // drop each as it succeeds so a mid-way failure keeps the rest
      }
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
      queryClient.invalidateQueries({ queryKey: ["wallet-tx"] });
      queryClient.invalidateQueries({ queryKey: getListBotsQueryKey() });
      touchedBots.forEach((botId) => {
        queryClient.invalidateQueries({ queryKey: getListBotPluginsQueryKey(botId) });
        queryClient.invalidateQueries({ queryKey: getGetBotQueryKey(botId) });
      });
      setAppliedDiscount(null);
      setDiscountInput("");
      toast({ title: fa ? "خرید با موفقیت انجام شد" : "Checkout complete" });
      setLocation("/bots");
    } catch (err: any) {
      // A discount code that was valid at "Apply" time but died before this request
      // (exhausted by a race, deactivated, expired) comes back with a reason code —
      // surface that plainly instead of a generic failure, and drop the stale quote
      // so a retry doesn't resend a dead code.
      if (err?.data?.code && ["not_found", "inactive", "expired", "exhausted"].includes(err.data.code)) {
        setAppliedDiscount(null);
        toast({ variant: "destructive", title: fa ? "کد تخفیف دیگر معتبر نیست" : "Discount code no longer valid", description: discountReasonText(err.data.code, fa) });
      } else {
        toast({ variant: "destructive", title: fa ? "خطا در پرداخت" : "Checkout failed", description: err?.data?.error || err?.message });
      }
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
        <ShoppingCart className="mx-auto size-10 text-muted-foreground" />
        <p className="text-muted-foreground">{fa ? "سبد خرید خالی است." : "Your cart is empty."}</p>
        <Button asChild variant="outline">
          <Link href="/buy-bot">{fa ? "خرید بات جدید" : "Buy a new bot"}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ms-2">
        <Link href="/bots"><BackArrow className="me-2 h-4 w-4" /> {fa ? "بازگشت" : "Back"}</Link>
      </Button>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{fa ? "تسویه‌حساب" : "Checkout"}</h1>
        <p className="text-sm text-muted-foreground">
          {fa ? "برای هر بات، مشخصات زیر را کامل کن تا دکمه‌ی پرداخت فعال شود." : "Fill in the details below for each bot to enable the pay button."}
        </p>
      </div>

      <div className="space-y-4">
        {items.map((item) =>
          item.kind === "plugin" ? (
            <Card key={item.key}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Blocks className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{fa ? `پلاگین · ${item.botName}` : `Plugin · ${item.botName}`}</p>
                </div>
                <span className="text-sm font-semibold">{item.price > 0 ? formatToman(item.price, lang) : (fa ? "رایگان" : "Free")}</span>
                <Button variant="ghost" size="icon" onClick={() => remove(item.key)}><Trash2 className="size-4 text-red-500" /></Button>
              </CardContent>
            </Card>
          ) : (
            <Card key={item.key}>
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <BotIcon className="size-4 text-primary" />
                  {item.tierName ? (fa ? `پکیج ${item.tierName}` : `${item.tierName} package`) : (fa ? "ربات جدید" : "New bot")}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{item.price > 0 ? formatToman(item.price, lang) : (fa ? "رایگان" : "Free")}</span>
                  <Button variant="ghost" size="icon" onClick={() => remove(item.key)}><Trash2 className="size-4 text-red-500" /></Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`phone-${item.key}`}>{fa ? "شماره تلفن *" : "Phone number *"}</Label>
                  <Input
                    id={`phone-${item.key}`}
                    dir="ltr"
                    placeholder="09123456789"
                    value={item.phone}
                    onChange={(e) => updateBot(item.key, { phone: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`tg-${item.key}`}>{fa ? "آیدی تلگرام *" : "Telegram ID *"}</Label>
                  <Input
                    id={`tg-${item.key}`}
                    dir="ltr"
                    placeholder="@username"
                    value={item.telegramId}
                    onChange={(e) => updateBot(item.key, { telegramId: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`name-${item.key}`}>{fa ? "اسم بات *" : "Bot name *"}</Label>
                  <Input
                    id={`name-${item.key}`}
                    placeholder={fa ? "مثلاً: فروشگاه من" : "e.g. My Shop"}
                    value={item.name}
                    onChange={(e) => updateBot(item.key, { name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`token-${item.key}`}>{fa ? "توکن بات *" : "Bot token *"}</Label>
                  <Input
                    id={`token-${item.key}`}
                    dir="ltr"
                    placeholder="123456:ABCdef..."
                    className="font-mono text-sm"
                    value={item.token}
                    onChange={(e) => updateBot(item.key, { token: e.target.value })}
                  />
                  <p className="text-xs">
                    <Link href="/learn/bot-token" className="text-orange-500 hover:underline">
                      {fa ? "چطور توکن بات را بگیرم؟" : "How do I get my bot token?"}
                    </Link>
                  </p>
                  {item.token.trim() && (tokenCounts.get(item.token.trim()) ?? 0) > 1 && (
                    <p className="text-xs font-medium text-red-500">
                      {fa
                        ? "این توکن در چند آیتم سبد تکرار شده — هر بات باید توکن جدا داشته باشد."
                        : "This token is used in more than one cart item — each bot needs its own token."}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`desc-${item.key}`}>{fa ? "توضیحات ساخت بات *" : "Bot build description *"}</Label>
                  <Textarea
                    id={`desc-${item.key}`}
                    placeholder={fa ? "بات را برای چه کاری می‌خواهی؟ چه امکاناتی نیاز داری؟" : "What is this bot for? What features do you need?"}
                    value={item.description}
                    onChange={(e) => updateBot(item.key, { description: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    {fa ? "این توضیحات توسط ادمین بررسی و تایید می‌شود." : "This description will be reviewed and approved by an admin."}
                  </p>
                </div>
              </CardContent>
            </Card>
          )
        )}
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1 text-muted-foreground"><Wallet className="size-3.5" /> {fa ? "موجودی" : "Balance"}</span>
            <span className={balance < payableTotal ? "text-red-500" : ""}>{formatToman(balance, lang)}</span>
          </div>
          <div className="flex items-center justify-between font-semibold">
            <span>{fa ? "جمع کل" : "Total"}</span>
            <span className={appliedDiscount ? "text-muted-foreground line-through" : ""}>{formatToman(total, lang)}</span>
          </div>

          {appliedDiscount && (
            <div className="flex items-center justify-between text-sm text-green-600 dark:text-green-500">
              <span className="flex items-center gap-1">
                <Tag className="size-3.5" />
                {fa ? `تخفیف (${appliedDiscount.code})` : `Discount (${appliedDiscount.code})`}
              </span>
              <span className="flex items-center gap-1">
                −{formatToman(appliedDiscount.discountAmount, lang)}
                <button
                  type="button"
                  onClick={removeDiscount}
                  className="ms-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={fa ? "حذف کد تخفیف" : "Remove discount code"}
                >
                  <X className="size-3.5" />
                </button>
              </span>
            </div>
          )}
          {appliedDiscount && (
            <div className="flex items-center justify-between text-base font-bold">
              <span>{fa ? "قابل پرداخت" : "Payable"}</span>
              <span>{formatToman(appliedDiscount.finalAmount, lang)}</span>
            </div>
          )}

          {!appliedDiscount && hasBotItems && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                dir="ltr"
                placeholder={fa ? "کد تخفیف" : "Discount code"}
                value={discountInput}
                onChange={(e) => { setDiscountInput(e.target.value); setDiscountErrorMsg(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyDiscount(); } }}
                className="flex-1 font-mono uppercase"
                disabled={discountBusy}
              />
              <Button
                type="button"
                variant="outline"
                disabled={!discountInput.trim() || discountBusy}
                onClick={applyDiscount}
              >
                {discountBusy ? <Loader2 className="size-4 animate-spin" /> : (fa ? "اعمال" : "Apply")}
              </Button>
            </div>
          )}
          {discountErrorMsg && !appliedDiscount && hasBotItems && (
            <p className="text-xs font-medium text-red-500">{discountErrorMsg}</p>
          )}
          {!hasBotItems && (
            <p className="text-xs text-muted-foreground">
              {fa ? "کد تخفیف فقط روی خرید بات جدید اعمال می‌شود، نه افزونه‌ها." : "Discount codes apply to new bot purchases, not plugins."}
            </p>
          )}

          <Separator />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" disabled={busy} onClick={clear}>
              {fa ? "خالی کردن سبد" : "Clear cart"}
            </Button>
            <GlowButton className="flex-1" wrapperClassName="flex-1" disabled={!canPay || busy} onClick={checkout}>
              {busy ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Wallet className="me-2 h-4 w-4" />}
              {fa ? "پرداخت از کیف پول" : "Pay from wallet"}
            </GlowButton>
          </div>
          {!allBotsComplete && (
            <p className="text-center text-xs text-muted-foreground">
              {fa ? "برای فعال شدن دکمه پرداخت، فیلدهای اجباری همه‌ی بات‌ها را کامل کن." : "Fill in every bot's required fields to enable payment."}
            </p>
          )}
          {allBotsComplete && hasDuplicateTokens && (
            <p className="text-center text-xs text-red-500">
              {fa ? "یک توکن تکراری در سبد وجود دارد؛ آن را اصلاح کن." : "A duplicate token is in your cart; fix it to continue."}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
