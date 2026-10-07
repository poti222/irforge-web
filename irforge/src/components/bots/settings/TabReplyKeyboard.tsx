/**
 * TabReplyKeyboard.tsx — «کیبورد پایین» چت.
 * ─────────────────────────────────────────────────────────────────────────────
 * تا امروز بات فقط کیبورد **اینلاین** داشت: دکمه‌هایی که به یک پیام می‌چسبند
 * و با اسکرول‌شدن آن پیام از دسترس خارج می‌شوند. کیبورد پایین همیشه زیر دست
 * کاربر می‌ماند و همان چیزی است که اکثر بات‌ها به‌عنوان «منوی اصلی» دارند.
 *
 * **همان سیستمِ دکمه‌ی پنل، عیناً.** دکمه‌های اینجا دیگر فقط متن نیستند —
 * `ButtonBuilder.tsx` (همان کامپوننتِ دکمه‌سازیِ پنل‌ها؛ `DripSection.tsx` هم
 * قبلاً همین‌طور دوباره‌استفاده‌اش کرده) عیناً همین‌جا هم به کار می‌رود، با
 * همان اکشن‌ها/توضیحات/انتخابگرها. تفاوت فقط این است که کیبورد پایین در
 * تلگرام payload ندارد — فقط متنِ خودش را می‌فرستد — پس زیرمجموعه‌ای از
 * اکشن‌ها که فقط با CallbackQuery معنی دارند (`catalog_order`، اکشن‌های
 * ثابتِ پلاگینی) اینجا در دسترس نیستند، و یک اکشنِ اضافه («متن آزاد/کامند
 * سفارشی») برای رفتارِ اصلی/عقب‌رو اضافه شده. رزولوشنِ این اکشن‌ها روی متنِ
 * پیام در `handlers/user.py::catch_all_text` انجام می‌شود.
 */
import type { Bot } from "@workspace/api-client-react";
import { Keyboard } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { SettingsSaveBar, SettingsError, CachePropagationNotice } from "./SettingsSaveBar";
import { useDraft } from "./useDraft";
import { usePatchBotSettings, type BotSettings, type SettingsEnvelope } from "./api";
import { ReplyKeyboardFields, rkToDraft, rkSerialize, type RkDraft } from "@/components/bots/ReplyKeyboardFields";

type KeyboardDraft = RkDraft & { enabled: boolean };

function pick(settings: BotSettings): KeyboardDraft {
  const kb = settings.reply_keyboard;
  return {
    // روی شیت، «خاموش» با `null` بیان می‌شود — یک فیلد `enabled` جدا وجود ندارد. اینجا به یک سوئیچ ترجمه می‌شود
    // تا کاربر برای خاموش‌کردن مجبور نباشد همه‌ی دکمه‌هایش را پاک کند.
    enabled: Boolean(kb && kb.rows?.length),
    ...rkToDraft(kb),
  };
}

export function TabReplyKeyboard({ bot, data }: { bot: Bot; data: SettingsEnvelope }) {
  const t = useT("botSettings");
  const { toast } = useToast();
  const draft = useDraft<KeyboardDraft>(`settings:replyKeyboard:${bot.id}`, pick(data.settings));
  const patch = usePatchBotSettings(bot.id);

  function save() {
    const cleaned = rkSerialize(draft.value);
    patch.mutate(
      {
        reply_keyboard: draft.value.enabled && cleaned ? cleaned : null,
      } as unknown as Partial<BotSettings>,
      {
        onSuccess: () => {
          draft.markSaved();
          toast({ title: t.saved, description: data.cacheBust ? t.propagationFast : t.propagationSlow });
        },
      }
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Keyboard className="size-4" /> {t.replyKeyboardTitle}
          </CardTitle>
          <CardDescription>{t.replyKeyboardDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div className="min-w-0">
              <Label htmlFor="rk-enabled">{t.replyKeyboardEnabled}</Label>
              <p className="text-xs text-muted-foreground">{t.replyKeyboardEnabledHint}</p>
            </div>
            <Switch
              id="rk-enabled"
              checked={draft.value.enabled}
              onCheckedChange={(v) => draft.set("enabled", v)}
            />
          </div>

          {draft.value.enabled && (
            <>
              <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                {t.replyKeyboardCommandHint}
              </p>
              <ReplyKeyboardFields
                botId={bot.id}
                value={draft.value}
                onChange={(patchValue) => {
                  for (const [k, v] of Object.entries(patchValue)) draft.set(k as keyof KeyboardDraft, v as never);
                }}
              />
            </>
          )}

          <SettingsError error={patch.error} />
          <CachePropagationNotice cacheBust={data.cacheBust} />
          <SettingsSaveBar
            dirty={draft.dirty}
            saving={patch.isPending}
            onSave={save}
            onRevert={draft.reset}
          />
        </CardContent>
      </Card>
    </div>
  );
}
