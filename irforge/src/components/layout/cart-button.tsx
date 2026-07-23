import { useState } from "react";
import {
  customFetch, getListBotsQueryKey, getListBotPluginsQueryKey, getGetBotQueryKey,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Trash2, Blocks, Bot, Plus, Loader2, Wallet } from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";

export function CartButton() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { items, count, total, addBot, remove, clear } = useCart();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // add-bot mini form
  const [botName, setBotName] = useState("");
  const [botToken, setBotToken] = useState("");
  const [botPrice, setBotPrice] = useState("");

  const { data: wallet } = useQuery({
    queryKey: ["wallet"],
    queryFn: () => customFetch<{ balance: number }>("/api/wallet"),
    enabled: open,
  });
  const balance = wallet?.balance ?? 0;

  function addBotToCart() {
    if (!botName.trim() || !botToken.trim()) {
      toast({ variant: "destructive", title: fa ? "نام و توکن الزامی است" : "Name and token are required" });
      return;
    }
    addBot({ name: botName.trim(), token: botToken.trim(), description: "", price: Number(botPrice) || 0 });
    setBotName(""); setBotToken(""); setBotPrice("");
  }

  async function checkout() {
    if (items.length === 0) return;
    if (balance < total) {
      toast({
        variant: "destructive",
        title: fa ? "موجودی کیف پول کافی نیست" : "Insufficient wallet balance",
        description: fa ? "ابتدا کیف پول را شارژ کنید." : "Top up your wallet first.",
      });
      setOpen(false);
      setLocation("/wallet");
      return;
    }
    setBusy(true);
    const touchedBots = new Set<string>();
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
            body: JSON.stringify({ name: item.name, token: item.token, description: item.description, amount: item.price }),
          });
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
      toast({ title: fa ? "خرید با موفقیت انجام شد" : "Checkout complete" });
      setOpen(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا در پرداخت" : "Checkout failed", description: err?.data?.error || err?.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button className="relative inline-flex size-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-primary hover:text-primary" aria-label="Cart">
          <ShoppingCart className="size-4" />
          {count > 0 && (
            <span className="absolute -end-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {count}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><ShoppingCart className="size-5" /> {fa ? "سبد خرید" : "Cart"}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-2 overflow-auto py-4">
          {items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{fa ? "سبد خرید خالی است." : "Your cart is empty."}</p>
          ) : (
            items.map((item) => (
              <div key={item.key} className="flex items-center gap-3 rounded-md border p-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  {item.kind === "plugin" ? <Blocks className="size-4" /> : <Bot className="size-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.kind === "plugin"
                      ? (fa ? `پلاگین · ${item.botName}` : `Plugin · ${item.botName}`)
                      : item.tierName
                        ? (fa ? `پکیج ${item.tierName}` : `${item.tierName} package`)
                        : (fa ? "ربات جدید" : "New bot")}
                  </p>
                </div>
                <span className="text-sm font-semibold">{item.price > 0 ? formatToman(item.price, lang) : (fa ? "رایگان" : "Free")}</span>
                <Button variant="ghost" size="icon" onClick={() => remove(item.key)}><Trash2 className="size-4 text-red-500" /></Button>
              </div>
            ))
          )}

          {/* Add a new bot to the cart */}
          <div className="mt-4 space-y-2 rounded-md border border-dashed p-3">
            <p className="text-xs font-semibold text-muted-foreground">{fa ? "افزودن ربات جدید" : "Add a new bot"}</p>
            <Input placeholder={fa ? "نام ربات" : "Bot name"} value={botName} onChange={(e) => setBotName(e.target.value)} />
            <Input placeholder={fa ? "توکن ربات" : "Bot token"} dir="ltr" className="font-mono text-xs" value={botToken} onChange={(e) => setBotToken(e.target.value)} />
            <div className="flex gap-2">
              <Input type="number" dir="ltr" placeholder={fa ? "قیمت (تومان)" : "Price (Toman)"} value={botPrice} onChange={(e) => setBotPrice(e.target.value)} />
              <Button variant="outline" onClick={addBotToCart}><Plus className="size-4" /></Button>
            </div>
          </div>
        </div>

        <div className="space-y-3 border-t pt-4">
          {open && (
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1 text-muted-foreground"><Wallet className="size-3.5" /> {fa ? "موجودی" : "Balance"}</span>
              <span className={balance < total ? "text-red-500" : ""}>{formatToman(balance, lang)}</span>
            </div>
          )}
          <div className="flex items-center justify-between font-semibold">
            <span>{fa ? "جمع کل" : "Total"}</span>
            <span>{formatToman(total, lang)}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" disabled={items.length === 0 || busy} onClick={clear}>
              {fa ? "خالی کردن" : "Clear"}
            </Button>
            <Button className="flex-1" disabled={items.length === 0 || busy} onClick={checkout}>
              {busy ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Wallet className="me-2 h-4 w-4" />}
              {fa ? "پرداخت از کیف پول" : "Pay from wallet"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
