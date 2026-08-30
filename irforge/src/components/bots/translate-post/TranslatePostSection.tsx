/**
 * TranslatePostSection.tsx — website management for the `translate_post` bot
 * plugin: configure the Google Translate API key + destination channel, then
 * compose and publish a post directly from here — full parity with the
 * Telegram-side admin flow (`plugins/translate_post/handlers.py` in the bot
 * repo), not a second-class subset of it.
 *
 * Inline fa/en strings (no `useT` locale namespace) — same convention as
 * admin-user-detail.tsx / support.tsx for newer, single-purpose pages.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { Globe, Loader2, Send, KeyRound, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";

type TranslatePostConfig = {
  channelId: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  sourceLang: string;
  enabled: boolean;
  configured: boolean;
};

type TranslatePostPostRow = {
  id: string;
  sourceText: string;
  sourceLang: string;
  languages: string[];
  channelMessageId: number | null;
  createdAt: string | null;
};

type PublishResult = {
  id: string;
  languages: string[];
  failedLanguages: string[];
  channelMessageId: number;
};

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}

export function TranslatePostSection({ bot }: { bot: Bot }) {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const qc = useQueryClient();

  const configKey = ["bot-translate-post-config", bot.id];
  const { data: config, isLoading, error } = useQuery({
    queryKey: configKey,
    queryFn: () => customFetch<TranslatePostConfig>(`/api/bots/${bot.id}/translate-post/config`),
  });

  const postsKey = ["bot-translate-post-posts", bot.id];
  const { data: postsData } = useQuery({
    queryKey: postsKey,
    queryFn: () => customFetch<{ posts: TranslatePostPostRow[] }>(`/api/bots/${bot.id}/translate-post/posts`),
    enabled: Boolean(config?.configured),
  });

  const activate = useMutation({
    mutationFn: () =>
      customFetch(`/api/bots/${bot.id}/plugins/translate_post`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: true }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-plugins", bot.id] });
      qc.invalidateQueries({ queryKey: configKey });
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: errMessage(err, fa ? "خطای ناشناخته" : "Unknown error") }),
  });

  const [channelId, setChannelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  useEffect(() => {
    if (config) setChannelId(config.channelId);
  }, [config?.channelId]);

  const saveConfig = useMutation({
    mutationFn: (patch: { channelId?: string; apiKey?: string; enabled?: boolean }) =>
      customFetch(`/api/bots/${bot.id}/translate-post/config`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: configKey });
      setApiKey("");
      toast({ title: fa ? "ذخیره شد" : "Saved" });
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: errMessage(err, fa ? "ذخیره نشد" : "Save failed") }),
  });

  const toggleEnabled = useMutation({
    mutationFn: (enabled: boolean) => customFetch(`/api/bots/${bot.id}/translate-post/config`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: configKey }),
    onError: (err: any) =>
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: errMessage(err, fa ? "خطا" : "Error") }),
  });

  const [sourceText, setSourceText] = useState("");
  const publish = useMutation({
    mutationFn: () =>
      customFetch<PublishResult>(`/api/bots/${bot.id}/translate-post/publish`, {
        method: "POST",
        body: JSON.stringify({ sourceText }),
      }),
    onSuccess: (res) => {
      setSourceText("");
      qc.invalidateQueries({ queryKey: postsKey });
      toast({
        title: fa ? `منتشر شد (${res.languages.length} زبان)` : `Published (${res.languages.length} languages)`,
        description: res.failedLanguages.length
          ? (fa
              ? `ترجمه به این زبان‌ها ناموفق بود: ${res.failedLanguages.join("، ")}`
              : `Translation failed for: ${res.failedLanguages.join(", ")}`)
          : undefined,
      });
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: fa ? "انتشار ناموفق بود" : "Publish failed", description: errMessage(err, "") }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {fa ? "در حال بارگذاری…" : "Loading…"}
      </div>
    );
  }

  if (errCode(error) === "plugin_disabled") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <Globe className="size-8 text-muted-foreground" />
          <p className="font-semibold">{fa ? "پلاگین «پستِ چندزبانه» خاموش است" : "The Translated Posts plugin is off"}</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {fa
              ? "برای انتشارِ پست‌های چندزبانه روی کانالتان، اول این پلاگین را روشن کنید."
              : "Turn this plugin on to publish multi-language posts to your channel."}
          </p>
          <Button onClick={() => activate.mutate()} disabled={activate.isPending}>
            {activate.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {fa ? "روشن کردن" : "Activate"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (error || !config) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {errCode(error) === "no_sheet"
          ? (fa ? "این بات هنوز شیت اختصاصی ندارد." : "This bot doesn't have a dedicated sheet yet.")
          : errMessage(error, fa ? "خطای ناشناخته" : "Unknown error")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4" /> {fa ? "تنظیمات" : "Settings"}
          </CardTitle>
          <CardDescription>
            {fa
              ? "کلیدِ Google Cloud Translation API خودتان و آیدیِ کانالِ مقصد — بات باید از قبل ادمینِ آن کانال باشد."
              : "Your own Google Cloud Translation API key and the destination channel — the bot must already be an admin there."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm">
              <Radio className="size-4 text-muted-foreground" />
              {fa ? "روشن" : "Enabled"}
            </div>
            <Switch
              checked={config.enabled}
              disabled={toggleEnabled.isPending}
              onCheckedChange={(v) => toggleEnabled.mutate(v)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tp-channel">{fa ? "آیدیِ کانالِ مقصد" : "Destination channel"}</Label>
            <Input
              id="tp-channel" dir="ltr" value={channelId} onChange={(e) => setChannelId(e.target.value)}
              placeholder="@my_channel یا -1001234567890"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tp-key">{fa ? "کلیدِ Google Translate API" : "Google Translate API key"}</Label>
            <Input
              id="tp-key" dir="ltr" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder={config.hasApiKey ? config.apiKeyMasked : (fa ? "هنوز تنظیم نشده" : "Not set yet")}
            />
            <p className="text-xs text-muted-foreground">
              {fa
                ? "خالی بگذارید تا کلیدِ فعلی دست‌نخورده بماند."
                : "Leave blank to keep the current key unchanged."}
            </p>
          </div>

          <Button
            onClick={() =>
              saveConfig.mutate({
                channelId: channelId.trim() || undefined,
                apiKey: apiKey.trim() || undefined,
              })
            }
            disabled={saveConfig.isPending}
          >
            {saveConfig.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {fa ? "ذخیره" : "Save"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="size-4" /> {fa ? "نوشتن و انتشارِ پستِ تازه" : "Compose & publish a new post"}
          </CardTitle>
          <CardDescription>
            {fa
              ? "متن را به زبانِ مبدأ (فارسی) بنویسید — به ۱۰ زبانِ دیگر ترجمه و با دکمه‌های انتخابِ زبان روی کانال منتشر می‌شود."
              : "Write the post in the source language (Persian) — it's translated into 10 other languages and published with language-picker buttons."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={6} value={sourceText} onChange={(e) => setSourceText(e.target.value)}
            placeholder={fa ? "متنِ پست…" : "Post text…"}
            disabled={!config.configured || publish.isPending}
          />
          {!config.configured && (
            <p className="text-xs text-amber-500">
              {fa ? "اول کلیدِ API و کانالِ مقصد را بالا تنظیم کنید." : "Set the API key and channel above first."}
            </p>
          )}
          <Button
            onClick={() => publish.mutate()}
            disabled={!config.configured || !sourceText.trim() || publish.isPending}
          >
            {publish.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            {publish.isPending ? (fa ? "در حالِ ترجمه و انتشار…" : "Translating & publishing…") : (fa ? "ترجمه و انتشار" : "Translate & publish")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{fa ? "پست‌های اخیر" : "Recent posts"}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {!postsData ? (
            <div className="h-16 animate-pulse rounded-md bg-muted" />
          ) : postsData.posts.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {fa ? "هنوز پستی منتشر نشده." : "No posts published yet."}
            </p>
          ) : (
            postsData.posts.map((p) => (
              <div key={p.id} className="space-y-1.5 rounded-md border p-3">
                <p className="line-clamp-2 text-sm">{p.sourceText}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">{p.languages.length} {fa ? "زبان" : "languages"}</Badge>
                  {p.createdAt && (
                    <span className="text-xs text-muted-foreground">
                      {new Date(p.createdAt).toLocaleString(fa ? "fa-IR" : "en-US")}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
