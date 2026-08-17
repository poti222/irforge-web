/**
 * PluginSection.tsx — سکشن یک پلاگین در workspace بات.
 *
 * هر پلاگین ممکن است چند مجموعه‌ی داده داشته باشد (رزرو نوبت سه تا: سرویس‌ها،
 * بازه‌ها، رزروها). این کامپوننت آن‌ها را به‌شکل تب نشان می‌دهد و خودِ جدول‌ها
 * را به `PluginCollectionTable` می‌سپارد.
 *
 * فهرست مجموعه‌ها **از سرور** می‌آید (`GET /bots/:id/plugin-collections`)، و
 * سرور فقط مجموعه‌های پلاگین‌های *فعال* را برمی‌گرداند. پس این فایل هیچ‌جا
 * نمی‌داند «رزرو نوبت سه تب دارد» — اضافه‌شدن یک تب در بات فقط یک خط در اسکیمای
 * سرور است.
 */
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/hooks/use-translation";
import { PluginCollectionTable, type CollectionSpec } from "./PluginCollectionTable";

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}

export function usePluginCollections(botId: string) {
  return useQuery({
    queryKey: ["bot-plugin-collections", botId],
    queryFn: () =>
      customFetch<{ collections: CollectionSpec[]; enabledPlugins: string[] }>(
        `/api/bots/${botId}/plugin-collections`,
      ),
    staleTime: 60_000,
  });
}

export function PluginSection({ bot, plugin }: { bot: Bot; plugin: string }) {
  const t = useT("botPluginData");
  const { data, isLoading, error } = usePluginCollections(bot.id);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t.loading}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        {errMessage(error, t.errorGeneric)}
      </div>
    );
  }

  const collections = (data?.collections ?? []).filter((c) => c.plugin === plugin);

  if (collections.length === 0) {
    // به این حالت نباید رسید — سایدبار سکشنِ پلاگین خاموش را اصلاً رندر نمی‌کند.
    // ولی یک بوکمارکِ کهنه یا پلاگینی که همین حالا خاموش شده می‌تواند اینجا
    // بیاورد، و یک صفحه‌ی سفید بدترین جواب است.
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        {t.pluginOff}
      </div>
    );
  }

  if (collections.length === 1) {
    return <PluginCollectionTable botId={bot.id} collection={collections[0].key} />;
  }

  return (
    <Tabs defaultValue={collections[0].key} className="space-y-4">
      <TabsList className="flex-wrap">
        {collections.map((collection) => (
          <TabsTrigger key={collection.key} value={collection.key}>
            {collection.titleFa}
          </TabsTrigger>
        ))}
      </TabsList>
      {collections.map((collection) => (
        <TabsContent key={collection.key} value={collection.key}>
          <PluginCollectionTable botId={bot.id} collection={collection.key} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
