import { useState } from "react";
import { Link } from "wouter";
import {
  useListMarketplaceItems,
  useListBots,
  useInstallPlugin,
  getListBotPluginsQueryKey,
  getGetBotQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import type { MarketplaceItem } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { MotionCard } from "@/components/ui/motion-card";
import { Button } from "@/components/ui/button";
import { Store, Download, Star, Loader2, Blocks, ShoppingCart, Wallet as WalletIcon } from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import { useT } from "@/hooks/use-translation";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";
import { usePrivatePageTitle } from "@/hooks/use-private-page-title";

export default function Marketplace() {
  usePrivatePageTitle(useT("pageTitles").marketplace);
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const tr = useT("marketplace");

  const { data: items, isLoading } = useListMarketplaceItems({});
  const { data: bots } = useListBots();
  const installPlugin = useInstallPlugin();
  const { addPlugin } = useCart();

  // Same query key as the wallet page, so the two share one cache entry and
  // the chip updates as soon as a deposit is approved there.
  const { data: wallet } = useQuery({
    queryKey: ["wallet"],
    queryFn: () => customFetch<{ balance: number }>("/api/wallet"),
    refetchInterval: 10000,
  });

  const [selected, setSelected] = useState<MarketplaceItem | null>(null);
  const [targetBot, setTargetBot] = useState<string>("");

  // Only real (approved) bots can host a plugin.
  const installableBots = (bots ?? []).filter((b) => b.status === "active" || b.status === "inactive");

  function openDetail(item: MarketplaceItem) {
    setSelected(item);
    setTargetBot(installableBots[0]?.id ?? "");
  }

  function install() {
    if (!selected || !targetBot) return;
    installPlugin.mutate(
      { botId: targetBot, data: { marketplaceItemId: selected.id } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBotPluginsQueryKey(targetBot) });
          queryClient.invalidateQueries({ queryKey: getGetBotQueryKey(targetBot) });
          toast({ title: fa ? `«${selected.name}» نصب شد` : `Installed “${selected.name}”` });
          setSelected(null);
        },
        onError: (err: any) => toast({ variant: "destructive", title: fa ? "خطا در نصب" : "Install failed", description: err?.message }),
      }
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{fa ? "بازار" : "Marketplace"}</h1>
          <p className="text-muted-foreground">
            {fa ? "پلاگین‌ها، قالب‌ها و کامپوننت‌ها برای ربات‌های شما." : "Discover plugins, templates, and components for your bots."}
          </p>
        </div>

        {/* Balance is the thing you need to know before buying a plugin, so it
            sits on this page rather than making you go and come back. */}
        <Link
          href="/wallet"
          title={tr.walletBalance}
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:border-primary/50 hover:text-primary"
          data-testid="marketplace-wallet-chip"
        >
          <WalletIcon className="size-4 text-primary" />
          <span className="text-muted-foreground">{tr.walletBalance}</span>
          <span className="font-semibold">{formatToman(wallet?.balance ?? 0, lang)}</span>
        </Link>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse"><CardHeader className="h-32" /><CardContent className="h-10" /></Card>
          ))}
        </div>
      ) : items && items.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => (
            <MotionCard key={item.id} className="flex flex-col">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <CardTitle className="text-lg">{item.name}</CardTitle>
                  <Badge variant={item.isFree ? "secondary" : "default"}>
                    {item.isFree ? (fa ? "رایگان" : "Free") : formatToman(item.price, lang)}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground flex gap-2">
                  <span className="capitalize">{item.category}</span> • <span>{fa ? "توسط" : "by"} {item.author}</span>
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                <p className="text-sm text-muted-foreground line-clamp-2">{item.description}</p>
                <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
                  <span className="flex items-center"><Star className="w-3 h-3 me-1 text-yellow-500" /> {item.rating}</span>
                  <span className="flex items-center"><Download className="w-3 h-3 me-1" /> {item.installCount}</span>
                </div>
              </CardContent>
              <CardFooter className="pt-4 border-t">
                <Button className="w-full" variant="outline" onClick={() => openDetail(item)}>
                  {fa ? "جزئیات" : "View Details"}
                </Button>
              </CardFooter>
            </MotionCard>
          ))}
        </div>
      ) : (
        <div className="text-center py-20 border rounded-lg bg-card">
          <Store className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">{fa ? "بازار خالی است" : "Marketplace is empty"}</h2>
        </div>
      )}

      {/* T1: item detail + install */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-lg">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Blocks className="h-5 w-5 text-primary" /> {selected.name}
                  <Badge variant="outline" dir="ltr" className="ms-1">v{selected.version}</Badge>
                </DialogTitle>
                <DialogDescription>{selected.description}</DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-1">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">{fa ? "دسته" : "Category"}: </span><span className="capitalize">{selected.category}</span></div>
                  <div><span className="text-muted-foreground">{fa ? "سازنده" : "Author"}: </span>{selected.author}</div>
                  <div className="flex items-center gap-1"><Star className="h-3.5 w-3.5 text-yellow-500" /> {selected.rating}</div>
                  <div className="flex items-center gap-1"><Download className="h-3.5 w-3.5" /> {selected.installCount}</div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">{fa ? "قیمت" : "Price"}: </span>
                    <span className="font-medium">{selected.isFree ? (fa ? "رایگان" : "Free") : formatToman(selected.price, lang)}</span>
                  </div>
                </div>

                {selected.tags && selected.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selected.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                  </div>
                )}

                <div className="space-y-2 rounded-md border p-3">
                  <Label>{fa ? "نصب روی ربات" : "Install on bot"}</Label>
                  {installableBots.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <Select value={targetBot} onValueChange={setTargetBot}>
                          <SelectTrigger className="flex-1"><SelectValue placeholder={fa ? "انتخاب ربات" : "Select a bot"} /></SelectTrigger>
                          <SelectContent>
                            {installableBots.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Button onClick={install} disabled={!targetBot || installPlugin.isPending}>
                          {installPlugin.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Download className="me-2 h-4 w-4" />}
                          {fa ? "نصب" : "Install"}
                        </Button>
                      </div>
                      <Button
                        variant="outline"
                        className="w-full"
                        disabled={!targetBot}
                        onClick={() => {
                          const bot = installableBots.find((b) => b.id === targetBot);
                          if (!selected || !bot) return;
                          addPlugin({
                            marketplaceItemId: selected.id, botId: bot.id, botName: bot.name,
                            name: selected.name, price: selected.isFree ? 0 : selected.price,
                          });
                          toast({ title: fa ? "به سبد خرید اضافه شد" : "Added to cart" });
                        }}
                      >
                        <ShoppingCart className="me-2 h-4 w-4" /> {fa ? "افزودن به سبد" : "Add to cart"}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {fa ? "ابتدا یک ربات فعال بسازید تا بتوانید نصب کنید." : "Create an active bot first to install onto it."}
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
