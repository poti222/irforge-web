import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListBots, customFetch } from "@workspace/api-client-react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  Globe, Check, Copy, Loader2, Save, Languages as LangIcon,
  MessageSquareText, Info, Bot as BotIcon, Sparkles, ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";
import { OrangeRobot } from "@/components/layout/brand-home";

type LangCode = "en" | "fa" | "ar" | "tr" | "ru";
interface BotLangConfig {
  mode: "single" | "multi";
  primary: LangCode;
  enabled: LangCode[];
  promptOnStart: boolean;
}
const DEFAULT_CONFIG: BotLangConfig = { mode: "single", primary: "fa", enabled: ["fa"], promptOnStart: true };

const LANGS: { code: LangCode; native: string; flag: string; en: string; fa: string }[] = [
  { code: "en", native: "English", flag: "🇬🇧", en: "English", fa: "انگلیسی" },
  { code: "fa", native: "فارسی", flag: "🇮🇷", en: "Persian", fa: "فارسی" },
  { code: "ar", native: "العربية", flag: "🇸🇦", en: "Arabic", fa: "عربی" },
  { code: "tr", native: "Türkçe", flag: "🇹🇷", en: "Turkish", fa: "ترکی" },
  { code: "ru", native: "Русский", flag: "🇷🇺", en: "Russian", fa: "روسی" },
];
const byCode = (c: LangCode) => LANGS.find((l) => l.code === c)!;

const GREETING: Record<LangCode, string> = {
  en: "Hi! How can I help you? 👋",
  fa: "سلام! چطور می‌تونم کمکت کنم؟ 👋",
  ar: "مرحبًا! كيف يمكنني مساعدتك؟ 👋",
  tr: "Merhaba! Size nasıl yardımcı olabilirim? 👋",
  ru: "Привет! Чем могу помочь? 👋",
};
const CHOOSE: Record<LangCode, string> = {
  en: "Please choose your language",
  fa: "لطفاً زبان خود را انتخاب کنید",
  ar: "يرجى اختيار لغتك",
  tr: "Lütfen dilinizi seçin",
  ru: "Пожалуйста, выберите язык",
};

export default function Language() {
  const { lang, toggleLang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();

  const { data: bots, isLoading: botsLoading } = useListBots();
  const [botId, setBotId] = useState<string | null>(null);
  useEffect(() => {
    if (!botId && bots && bots.length > 0) setBotId(bots[0].id);
  }, [bots, botId]);

  const { data: loaded } = useQuery({
    queryKey: ["bot-language", botId],
    queryFn: () => customFetch<BotLangConfig>(`/api/bots/${botId}/language`),
    enabled: !!botId,
  });

  const [form, setForm] = useState<BotLangConfig>(DEFAULT_CONFIG);
  useEffect(() => { if (loaded) setForm(loaded); }, [loaded]);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  function setMode(mode: "single" | "multi") {
    setForm((f) => ({ ...f, mode, enabled: mode === "single" ? [f.primary] : Array.from(new Set([f.primary, ...f.enabled])) }));
  }
  function setPrimary(primary: LangCode) {
    setForm((f) => ({
      ...f,
      primary,
      enabled: f.mode === "single" ? [primary] : Array.from(new Set([primary, ...f.enabled])),
    }));
  }
  function toggleEnabled(code: LangCode) {
    setForm((f) => {
      if (code === f.primary) return f; // primary is always on
      const on = f.enabled.includes(code);
      return { ...f, enabled: on ? f.enabled.filter((c) => c !== code) : [...f.enabled, code] };
    });
  }

  async function save() {
    if (!botId) return;
    setSaving(true);
    try {
      await customFetch(`/api/bots/${botId}/language`, { method: "PUT", body: JSON.stringify(form) });
      toast({ title: fa ? "زبان ذخیره شد ✅" : "Language saved ✅", description: fa ? "کانفیگ توی شیتِ بات نوشته شد." : "Config written to the bot's sheet." });
    } catch (e: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: e?.message });
    } finally {
      setSaving(false);
    }
  }

  const botFatherCmd = "language - " + (fa ? "تغییر زبان / Change language" : "Change language / تغییر زبان");
  const orderedEnabled = LANGS.filter((l) => form.enabled.includes(l.code));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Globe className="size-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{fa ? "زبان" : "Language"}</h1>
          <p className="text-sm text-muted-foreground">
            {fa ? "زبانِ سایت و زبانِ رباتِ تلگرام‌ات را اینجا تنظیم کن." : "Set the language of the site and your Telegram bot here."}
          </p>
        </div>
      </div>

      {/* Site language */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <LangIcon className="size-5 text-muted-foreground" />
            <div>
              <p className="font-medium">{fa ? "زبانِ سایت" : "Site language"}</p>
              <p className="text-sm text-muted-foreground">
                {fa ? "زبانِ پنل و داشبورد. الان: فارسی" : "The dashboard UI language. Now: English"}
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={toggleLang}>
            {fa ? "تغییر به English" : "تغییر به فارسی"}
          </Button>
        </CardContent>
      </Card>

      <Separator />

      {/* Bot language */}
      <div className="flex items-center gap-2">
        <BotIcon className="size-5 text-primary" />
        <h2 className="text-lg font-bold">{fa ? "زبانِ ربات" : "Bot language"}</h2>
      </div>

      {botsLoading ? (
        <Card className="animate-pulse"><CardContent className="h-40" /></Card>
      ) : !bots || bots.length === 0 ? (
        <div className="rounded-xl border border-dashed py-14 text-center">
          <BotIcon className="mx-auto mb-3 size-9 text-muted-foreground" />
          <p className="mb-4 text-sm text-muted-foreground">
            {fa ? "اول یک ربات بساز تا زبانش را تنظیم کنی." : "Create a bot first to configure its language."}
          </p>
          <Button asChild><Link href="/bots?create=1">{fa ? "ساخت ربات" : "Create a bot"}</Link></Button>
        </div>
      ) : (
        <>
          {/* Bot selector */}
          {bots.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {bots.map((b) => (
                <button
                  key={b.id}
                  onClick={() => setBotId(b.id)}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    botId === b.id ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
                  }`}
                >
                  {b.name}
                </button>
              ))}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {/* ── Config ── */}
            <div className="space-y-5">
              {/* Mode */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{fa ? "حالتِ زبان" : "Language mode"}</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  {([
                    { key: "single", title: fa ? "تک‌زبانه" : "Single", desc: fa ? "کل بات به یک زبان" : "One language for all" },
                    { key: "multi", title: fa ? "چندزبانه" : "Multilingual", desc: fa ? "کاربر موقع /start انتخاب می‌کند" : "User picks on /start" },
                  ] as const).map((m) => (
                    <button
                      key={m.key}
                      onClick={() => setMode(m.key)}
                      className={`rounded-xl border p-3 text-start transition-all ${
                        form.mode === m.key ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/40"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{m.title}</span>
                        {form.mode === m.key && <Check className="size-4 text-primary" />}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{m.desc}</p>
                    </button>
                  ))}
                </CardContent>
              </Card>

              {/* Primary language */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{fa ? "زبانِ اصلی" : "Primary language"}</CardTitle>
                  <CardDescription>{fa ? "زبانِ پیش‌فرضِ بات (توسط ادمینِ بات)." : "The bot's default language (chosen by you)."}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {LANGS.map((l) => (
                    <button
                      key={l.code}
                      onClick={() => setPrimary(l.code)}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                        form.primary === l.code ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
                      }`}
                    >
                      <span className="text-base leading-none">{l.flag}</span>
                      {l.native}
                    </button>
                  ))}
                </CardContent>
              </Card>

              {/* Enabled languages (multi only) */}
              {form.mode === "multi" && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{fa ? "زبان‌های فعال" : "Enabled languages"}</CardTitle>
                    <CardDescription>{fa ? "زبان‌هایی که به کاربر پیشنهاد می‌شود." : "Languages offered to the user."}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    {LANGS.map((l) => {
                      const on = form.enabled.includes(l.code);
                      const isPrimary = l.code === form.primary;
                      return (
                        <button
                          key={l.code}
                          onClick={() => toggleEnabled(l.code)}
                          disabled={isPrimary}
                          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                            on ? "border-primary/60 bg-primary/10 text-primary" : "opacity-60 hover:bg-muted hover:opacity-100"
                          } ${isPrimary ? "cursor-default" : ""}`}
                        >
                          <span className="text-base leading-none">{l.flag}</span>
                          {l.native}
                          {on && <Check className="size-3.5" />}
                          {isPrimary && <Badge variant="secondary" className="ms-1 h-4 px-1 text-[9px]">{fa ? "اصلی" : "primary"}</Badge>}
                        </button>
                      );
                    })}
                  </CardContent>
                </Card>
              )}

              {/* Prompt on start */}
              <Card>
                <CardContent className="flex items-center justify-between gap-4 p-4">
                  <div>
                    <p className="font-medium">{fa ? "انتخابِ زبان در اولین /start" : "Language picker on first /start"}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {fa ? "خاموش که باشد، فقط با کامندِ /language باز می‌شود." : "When off, it only opens via the /language command."}
                    </p>
                  </div>
                  <Switch
                    checked={form.promptOnStart}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, promptOnStart: v }))}
                    disabled={form.mode === "single"}
                    data-testid="prompt-toggle"
                  />
                </CardContent>
              </Card>

              <Button onClick={save} disabled={saving || !botId} className="w-full" data-testid="save-language">
                {saving ? <Loader2 className="me-2 size-4 animate-spin" /> : <Save className="me-2 size-4" />}
                {fa ? "ذخیره زبان" : "Save language"}
              </Button>
            </div>

            {/* ── Preview + tutorial ── */}
            <div className="space-y-5">
              {/* Telegram preview */}
              <Card className="overflow-hidden">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <MessageSquareText className="size-4 text-primary" />
                    {fa ? "پیش‌نمایش در تلگرام" : "Telegram preview"}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-2xl bg-[#0e1621] p-4">
                    <div className="flex items-start gap-2">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <OrangeRobot className="size-5" />
                      </span>
                      <div className="max-w-[85%] space-y-2 rounded-2xl rounded-ss-sm bg-[#182533] px-3 py-2 text-sm text-white" dir="auto">
                        {form.mode === "multi" && form.promptOnStart ? (
                          <>
                            <div className="space-y-0.5">
                              {orderedEnabled.slice(0, 3).map((l) => (
                                <p key={l.code} className="leading-tight opacity-90">{CHOOSE[l.code]}</p>
                              ))}
                            </div>
                            <div className="grid grid-cols-2 gap-1.5 pt-1">
                              {orderedEnabled.map((l) => (
                                <span key={l.code} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2b5278] px-2 py-1.5 text-[13px] font-medium text-white">
                                  <span>{l.flag}</span>{l.native}
                                </span>
                              ))}
                            </div>
                          </>
                        ) : (
                          <p dir="auto">{GREETING[form.primary]}</p>
                        )}
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {form.mode === "multi" && form.promptOnStart
                      ? (fa ? "کاربر یکی را می‌زند و بات با همان زبان ادامه می‌دهد." : "The user taps one and the bot continues in that language.")
                      : form.mode === "single"
                        ? (fa ? "تک‌زبانه: بات مستقیم با زبانِ اصلی شروع می‌کند." : "Single: the bot starts directly in the primary language.")
                        : (fa ? "پیامِ اول خاموش است؛ کاربر با /language زبان را عوض می‌کند." : "First-prompt off; the user changes it with /language.")}
                  </p>
                </CardContent>
              </Card>

              {/* BotFather tutorial */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="size-4 text-primary" />
                    {fa ? "افزودنِ کامندِ /language در BotFather" : "Add the /language command in BotFather"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ol className="space-y-1.5 text-sm text-muted-foreground">
                    <li>۱ — {fa ? "به " : "Open "}<a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">@BotFather</a>{fa ? " برو" : ""}</li>
                    <li>۲ — {fa ? "بزن " : "Send "}<code dir="ltr" className="rounded bg-muted px-1 font-mono text-xs">/setcommands</code>{fa ? " و باتت را انتخاب کن" : " and pick your bot"}</li>
                    <li>۳ — {fa ? "این خط را بفرست:" : "Send this line:"}</li>
                  </ol>
                  <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2">
                    <code dir="ltr" className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs">{botFatherCmd}</code>
                    <Button
                      variant="ghost" size="icon" className="size-7 shrink-0"
                      onClick={() => { navigator.clipboard.writeText(botFatherCmd); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                      aria-label="copy"
                    >
                      {copied ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
                    </Button>
                  </div>
                  <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-xs text-muted-foreground">
                    <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    {fa
                      ? "این تنظیمات توی گوگل‌شیتِ باتت ذخیره می‌شود؛ رباتِ شما (Railway) آن را می‌خواند و رفتارِ چندزبانه را اجرا می‌کند."
                      : "This config is saved to your bot's Google Sheet; your Railway bot reads it and runs the multilingual behavior."}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
