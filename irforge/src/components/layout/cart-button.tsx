import { useState } from "react";
import { useLocation } from "wouter";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Trash2, Blocks, Bot } from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";

export function CartButton() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const [, setLocation] = useLocation();
  const { items, count, total, remove, clear } = useCart();

  const [open, setOpen] = useState(false);

  function goToCheckout() {
    setOpen(false);
    setLocation("/bots/cart");
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
                  <p className="truncate text-sm font-medium">
                    {item.kind === "plugin"
                      ? item.name
                      : (item.tierName
                          ? (fa ? `پکیج ${item.tierName}` : `${item.tierName} package`)
                          : (fa ? "ربات جدید" : "New bot"))}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.kind === "plugin"
                      ? (fa ? `پلاگین · ${item.botName}` : `Plugin · ${item.botName}`)
                      : (fa ? "در انتظار تکمیل اطلاعات در تسویه‌حساب" : "Awaiting details at checkout")}
                  </p>
                </div>
                <span className="text-sm font-semibold">{item.price > 0 ? formatToman(item.price, lang) : (fa ? "رایگان" : "Free")}</span>
                <Button variant="ghost" size="icon" onClick={() => remove(item.key)}><Trash2 className="size-4 text-red-500" /></Button>
              </div>
            ))
          )}
        </div>

        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center justify-between font-semibold">
            <span>{fa ? "جمع کل" : "Total"}</span>
            <span>{formatToman(total, lang)}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" disabled={items.length === 0} onClick={clear}>
              {fa ? "خالی کردن" : "Clear"}
            </Button>
            <Button className="flex-1" disabled={items.length === 0} onClick={goToCheckout}>
              <ShoppingCart className="me-2 h-4 w-4" />
              {fa ? "رفتن به تسویه‌حساب" : "Go to checkout"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
