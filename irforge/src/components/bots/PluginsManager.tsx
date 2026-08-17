/**
 * PluginsManager.tsx — پلاگین‌ها (بازنویسی‌شده، فاز ۱۷).
 *
 * باگ B14: قبلاً این صفحه فقط جدول `installed_plugins` سایت را نشان می‌داد،
 * یعنی «خریداری‌شده». اما چیزی که بات واقعاً می‌خواند کلید `__plugin_states__`
 * در تب `bot_settings` است. دو مفهوم کاملاً جدا با یک برچسب «فعال».
 *
 * حالا هر کارت **هر دو** را نشان می‌دهد: سوییچ فعال/غیرفعال که روی خود بات اثر
 * می‌گذارد، و بجِ جدای وضعیت خرید.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useInstallPlugin,
  useListMarketplaceItems,
} from "@workspace/api-client-react";
import type { MarketplaceItem } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Blocks, Loader2, PlusCircle, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { formatToman } from "@/lib/format";

type BotPlugin = {
  id: string;
  name: string;
  name_fa: string;
  description: string;
  version: string;
  default_enabled: boolean;
  required_sheets: string[];
  enabled: boolean;
  explicit: boolean;
  purchased: boolean;
  purchasedAt: string | null;
  marketplaceItemId: string | null;
};

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}

export function PluginsManager({ botId }: { botId: string }) {
  const t = useT("botPlugins");
  const { toast } = useToast();
  const qc = useQueryClient();

  const pluginsKey = ["bot-plugins", botId] as const;
  const { data, isLoading, error } = useQuery({
    queryKey: pluginsKey,
    queryFn: () =>
      customFetch<{ plugins: BotPlugin[]; unknown: string[]; catalogPublished: boolean }>(
        `/api/bots/${botId}/plugins`,
      ),
  });

  const { data: marketplaceItems, isLoading: marketplaceLoading } = useListMarketplaceItems({
    category: "plugin",
  });
  const install = useInstallPlugin();

  const toggle = useMutation({
    mutationFn: ({ pluginId, enabled }: { pluginId: string; enabled: boolean }) =>
      customFetch(`/api/bots/${botId}/plugins/${pluginId}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: pluginsKey }),
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
  if (error || !data) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {errCode(error) === "no_sheet" ? t.noSheetYet : errMessage(error, t.errorGeneric)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-1 text-base font-semibold">{t.installedTitle}</h3>
        <p className="mb-3 text-sm text-muted-foreground">{t.installedDesc}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          {data.plugins.map((plugin) => (
            <Card key={plugin.id}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-start gap-2 text-base">
                  <Blocks className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">{plugin.name_fa || plugin.name}</span>
                  <Switch
                    checked={plugin.enabled}
                    disabled={toggle.isPending}
                    aria-label={plugin.enabled ? t.disable : t.enable}
                    onCheckedChange={(v) => toggle.mutate({ pluginId: plugin.id, enabled: v })}
                  />
                </CardTitle>
                <CardDescription>{plugin.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline" dir="ltr">v{plugin.version}</Badge>
                {plugin.purchased ? (
                  <Badge variant="secondary">{t.purchased}</Badge>
                ) : (
                  <Badge variant="outline">{t.notPurchased}</Badge>
                )}
                {/* «تعیین‌نشده» با «غیرفعال» یکی نیست: بات در این حالت از
                    default_enabled مانیفست استفاده می‌کند. */}
                {!plugin.explicit && (
                  <span className="text-muted-foreground">
                    {t.usingDefault.replace("{state}", plugin.default_enabled ? t.enabled : t.disabled)}
                  </span>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* فهرست پایه ≠ فهرست کامل. بی این هشدار، کاربر فکر می‌کرد پلاگین‌های
            تازه‌ی باتش وجود ندارند. */}
        {data.catalogPublished === false && (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>{t.catalogUnpublished}</span>
          </p>
        )}

        {data.unknown.length > 0 && (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span dir="ltr">{t.unknownPlugins.replace("{ids}", data.unknown.join(", "))}</span>
          </p>
        )}

        <p className="mt-3 flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>{t.sourceOfTruthNotice}</span>
        </p>
      </div>

      <div>
        <h3 className="mb-1 text-base font-semibold">{t.marketplaceTitle}</h3>
        <p className="mb-3 text-sm text-muted-foreground">{t.marketplaceDesc}</p>

        {marketplaceLoading ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {(marketplaceItems ?? []).map((item: MarketplaceItem) => (
              <Card key={item.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{item.name}</CardTitle>
                  <CardDescription>{item.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {item.isFree || item.price <= 0 ? t.free : formatToman(item.price)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ms-auto"
                    disabled={install.isPending}
                    onClick={() =>
                      install.mutate(
                        { botId, data: { marketplaceItemId: item.id } },
                        {
                          onSuccess: () => {
                            qc.invalidateQueries({ queryKey: pluginsKey });
                            toast({ title: t.installed });
                          },
                          onError: (err: any) =>
                            toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
                        }
                      )
                    }
                  >
                    <PlusCircle className="me-1.5 size-4" /> {t.install}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
