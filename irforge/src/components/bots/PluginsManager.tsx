import {
  useListBotPlugins,
  useInstallPlugin,
  useUninstallPlugin,
  useListMarketplaceItems,
  getListBotPluginsQueryKey,
} from "@workspace/api-client-react";
import type { InstalledPlugin, MarketplaceItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Blocks, Loader2, Trash2, PlusCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";

export function PluginsManager({ botId }: { botId: string }) {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: installed, isLoading: installedLoading } = useListBotPlugins(botId);
  const { data: marketplaceItems, isLoading: marketplaceLoading } = useListMarketplaceItems({ category: "plugin" });
  const install = useInstallPlugin();
  const uninstall = useUninstallPlugin();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListBotPluginsQueryKey(botId) });
  };

  function onError(err: any, fallback: string) {
    toast({ variant: "destructive", title: fallback, description: err?.message });
  }

  function onInstall(item: MarketplaceItem) {
    install.mutate(
      { botId, data: { marketplaceItemId: item.id } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: fa ? `«${item.name}» نصب شد` : `“${item.name}” installed` });
        },
        onError: (err: any) => onError(err, fa ? "خطا در نصب" : "Install failed"),
      }
    );
  }

  function onUninstall(p: InstalledPlugin) {
    uninstall.mutate(
      { botId, pluginId: p.id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: fa ? `«${p.name}» حذف شد` : `“${p.name}” removed` });
        },
        onError: (err: any) => onError(err, fa ? "خطا در حذف" : "Uninstall failed"),
      }
    );
  }

  const installedIds = new Set((installed ?? []).map((p) => p.marketplaceItemId));
  const availableItems = (marketplaceItems ?? []).filter((item) => !installedIds.has(item.id));

  return (
    <div className="space-y-6">
      {/* Installed plugins */}
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">{fa ? "پلاگین‌های نصب‌شده" : "Installed Plugins"}</h3>
          <p className="text-sm text-muted-foreground">
            {fa
              ? "این پلاگین‌ها روی این بات نصب هستن."
              : "These plugins are installed on this bot."}
          </p>
        </div>

        {installedLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-md bg-muted" />)}
          </div>
        ) : (installed ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {fa ? "هنوز هیچ پلاگینی نصب نشده." : "No plugins installed yet."}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {(installed ?? []).map((p) => {
              const busy = uninstall.isPending && uninstall.variables?.pluginId === p.id;
              return (
                <Card key={p.id}>
                  <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Blocks className="h-4 w-4 text-primary" /> {p.name}
                    </CardTitle>
                    <Badge variant={p.enabled ? "secondary" : "outline"}>
                      {p.enabled ? (fa ? "فعال" : "enabled") : (fa ? "غیرفعال" : "disabled")}
                    </Badge>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" dir="ltr">v{p.version}</Badge>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => onUninstall(p)} disabled={busy}>
                      {busy ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Trash2 className="me-2 h-4 w-4" />}
                      {fa ? "حذف" : "Remove"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Available to install */}
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">{fa ? "پلاگین‌های موجود" : "Available Plugins"}</h3>
          <p className="text-sm text-muted-foreground">
            {fa ? "از مارکت‌پلیس روی این بات نصب کنید." : "Install from the marketplace onto this bot."}
          </p>
        </div>

        {marketplaceLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-md bg-muted" />)}
          </div>
        ) : availableItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {fa ? "همه‌ی پلاگین‌های موجود نصب شدن." : "All available plugins are installed."}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {availableItems.map((item) => {
              const busy = install.isPending && install.variables?.data.marketplaceItemId === item.id;
              return (
                <Card key={item.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Blocks className="h-4 w-4 text-primary" /> {item.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" dir="ltr">v{item.version}</Badge>
                      <Badge variant="outline">{item.isFree || item.price === 0 ? (fa ? "رایگان" : "Free") : formatToman(item.price, lang)}</Badge>
                    </div>
                    <Button size="sm" onClick={() => onInstall(item)} disabled={busy}>
                      {busy ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <PlusCircle className="me-2 h-4 w-4" />}
                      {fa ? "نصب" : "Install"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
