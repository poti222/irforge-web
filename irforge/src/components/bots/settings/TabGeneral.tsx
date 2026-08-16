/**
 * TabGeneral.tsx — نام/توضیح بات (Postgres سایت) + زبان، ارز، واترمارک و حالت
 * تعمیر (تب `bot_settings` شیت تننت).
 *
 * دو منبع در یک تب عمدی است: از دید کاربر «اطلاعات پایه‌ی بات» یک چیز است.
 * ولی دو دکمه‌ی ذخیره‌ی جدا دارند چون دو سیستم متفاوت‌اند و یکی می‌تواند بدون
 * دیگری شکست بخورد.
 */
import { useState } from "react";
import {
  useUpdateBot,
  getGetBotQueryKey,
  getListBotsQueryKey,
} from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { useUnsavedGuard } from "@/lib/unsaved-changes";
import { SettingsSaveBar, SettingsError, CachePropagationNotice } from "./SettingsSaveBar";
import { useDraft } from "./useDraft";
import { usePatchBotSettings, type BotSettings, type SettingsEnvelope } from "./api";

const BOT_LANGUAGES = ["fa", "en", "tr", "ar", "ru"] as const;

type GeneralDraft = {
  language: string;
  currency: string;
  /**
   * یوزرنیم پشتیبانی. قبلاً در تب «پرداخت» بود؛ وقتی آن تب به سکشن
   * پرداخت‌ها (پشت گیت پلاگین کیف پول) منتقل شد، این همراهش نیامد — باتی
   * بدون فروش هم به راه تماس با پشتیبانی نیاز دارد.
   */
  support_username: string;
  watermark: string;
  watermark_enabled: boolean;
  maintenance: boolean;
  maintenance_msg: string;
};

function pick(settings: BotSettings): GeneralDraft {
  return {
    language: settings.language,
    currency: settings.currency,
    support_username: settings.support_username,
    watermark: settings.watermark,
    watermark_enabled: settings.watermark_enabled,
    maintenance: settings.maintenance,
    maintenance_msg: settings.maintenance_msg,
  };
}

export function TabGeneral({ bot, data }: { bot: Bot; data: SettingsEnvelope }) {
  const t = useT("botSettings");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ─── بخش سایت: نام و توضیح ───────────────────────────────────────────────
  const [name, setName] = useState(bot.name);
  const [description, setDescription] = useState(bot.description ?? "");
  const updateBot = useUpdateBot();
  const identityDirty = name !== bot.name || description !== (bot.description ?? "");
  useUnsavedGuard(`settings:identity:${bot.id}`, identityDirty);

  function saveIdentity() {
    if (!name.trim()) {
      toast({ variant: "destructive", title: t.nameRequired });
      return;
    }
    updateBot.mutate(
      { botId: bot.id, data: { name: name.trim(), description: description.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBotQueryKey(bot.id) });
          queryClient.invalidateQueries({ queryKey: getListBotsQueryKey() });
          toast({ title: t.saved });
        },
        onError: (err: any) =>
          toast({ variant: "destructive", title: t.errorGeneric, description: err?.data?.error ?? err?.message }),
      }
    );
  }

  // ─── بخش شیت تننت ────────────────────────────────────────────────────────
  const draft = useDraft<GeneralDraft>(`settings:general:${bot.id}`, pick(data.settings));
  const patch = usePatchBotSettings(bot.id);

  function saveSheetSide() {
    patch.mutate(draft.value as Partial<BotSettings>, {
      onSuccess: () => toast({ title: t.saved, description: data.cacheBust ? t.propagationFast : t.propagationSlow }),
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t.identityTitle}</CardTitle>
          <CardDescription>{t.identityDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="gen-name">{t.botName}</Label>
            <Input id="gen-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gen-desc">{t.botDescription}</Label>
            <Textarea id="gen-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="border-t pt-4">
            <Button onClick={saveIdentity} disabled={!identityDirty || updateBot.isPending}>
              {updateBot.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Save className="me-2 h-4 w-4" />}
              {t.save}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.behaviourTitle}</CardTitle>
          <CardDescription>{t.behaviourDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="gen-lang">{t.defaultLanguage}</Label>
              <Select value={draft.value.language} onValueChange={(v) => draft.set("language", v)}>
                <SelectTrigger id="gen-lang"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BOT_LANGUAGES.map((l) => (
                    <SelectItem key={l} value={l}>{t[`lang_${l}` as keyof typeof t] as string}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gen-support">{t.supportUsername}</Label>
              <Input
                id="gen-support"
                dir="ltr"
                placeholder="@support"
                value={draft.value.support_username}
                onChange={(e) => draft.set("support_username", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t.supportUsernameHint}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gen-currency">{t.currency}</Label>
              <Input
                id="gen-currency"
                value={draft.value.currency}
                maxLength={20}
                onChange={(e) => draft.set("currency", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t.currencyHint}</p>
            </div>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Label htmlFor="gen-wm-enabled">{t.watermarkEnabled}</Label>
                <p className="text-xs text-muted-foreground">{t.watermarkHint}</p>
              </div>
              <Switch
                id="gen-wm-enabled"
                checked={draft.value.watermark_enabled}
                onCheckedChange={(v) => draft.set("watermark_enabled", v)}
              />
            </div>
            <Input
              value={draft.value.watermark}
              disabled={!draft.value.watermark_enabled}
              placeholder={t.watermarkPlaceholder}
              onChange={(e) => draft.set("watermark", e.target.value)}
            />
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Label htmlFor="gen-maint">{t.maintenance}</Label>
                <p className="text-xs text-muted-foreground">{t.maintenanceHint}</p>
              </div>
              <Switch
                id="gen-maint"
                checked={draft.value.maintenance}
                onCheckedChange={(v) => draft.set("maintenance", v)}
              />
            </div>
            <Textarea
              rows={2}
              value={draft.value.maintenance_msg}
              disabled={!draft.value.maintenance}
              onChange={(e) => draft.set("maintenance_msg", e.target.value)}
            />
          </div>

          <SettingsError error={patch.error} />
          <CachePropagationNotice cacheBust={data.cacheBust} />
          <SettingsSaveBar
            dirty={draft.dirty}
            saving={patch.isPending}
            onSave={saveSheetSide}
            onRevert={draft.reset}
          />
        </CardContent>
      </Card>
    </div>
  );
}
