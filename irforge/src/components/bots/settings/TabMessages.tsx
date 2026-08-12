/**
 * TabMessages.tsx — هر ۱۱ پیام متنی بات، در یک صفحه.
 *
 * دو چیزی که این تب را از یک لیست textarea جدا می‌کند:
 *  - شمارنده‌ی کاراکتر با سقف واقعی تلگرام (۴۰۰۰) — سرور هم همین را enforce می‌کند.
 *  - چیپ‌های placeholder: `{order_id}` و رفقایش را در **محل کرسر** درج می‌کنند،
 *    و اگر کاربر یک placeholder اجباری را پاک کند هشدار می‌دهد. بدون این،
 *    پیام تأیید سفارش بدون `{order_id}` ذخیره می‌شود و کاربر تازه در تلگرام
 *    می‌فهمد شماره‌ی سفارش گم شده.
 */
import { useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { SettingsSaveBar, SettingsError, CachePropagationNotice } from "./SettingsSaveBar";
import { useDraft } from "./useDraft";
import { usePatchBotSettings, type BotSettings, type SettingsEnvelope } from "./api";

const TELEGRAM_TEXT_LIMIT = 4000;

/** همان ۱۱ پیامی که فاز ۴ می‌خواهد، به ترتیبی که کاربر با آن‌ها روبه‌رو می‌شود. */
const MESSAGE_FIELDS = [
  "welcome_msg",
  "error_msg",
  "not_found_msg",
  "panel_inactive_msg",
  "banned_msg",
  "maintenance_msg",
  "force_join_message",
  "support_message",
  "order_confirm_msg",
  "order_reject_msg",
  "order_track_msg",
] as const;

type MessageField = (typeof MESSAGE_FIELDS)[number];

/** placeholderهایی که بات موقع ارسال جایگزین می‌کند. */
const PLACEHOLDERS: Partial<Record<MessageField, string[]>> = {
  support_message: ["{support}"],
  order_confirm_msg: ["{order_id}", "{amount}"],
  order_reject_msg: ["{order_id}", "{reason}"],
  order_track_msg: ["{order_id}", "{reason}"],
};

type MessagesDraft = Record<MessageField, string>;

function pick(settings: BotSettings): MessagesDraft {
  const out = {} as MessagesDraft;
  for (const f of MESSAGE_FIELDS) out[f] = settings[f];
  return out;
}

function MessageEditor({
  field,
  value,
  onChange,
}: {
  field: MessageField;
  value: string;
  onChange: (next: string) => void;
}) {
  const t = useT("botSettings");
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const placeholders = PLACEHOLDERS[field] ?? [];
  const missing = placeholders.filter((p) => !value.includes(p));
  const tooLong = value.length > TELEGRAM_TEXT_LIMIT;

  /** درج در محل کرسر، نه ته متن — وگرنه چیپ‌ها عملاً بی‌فایده‌اند. */
  function insert(token: string) {
    const el = ref.current;
    if (!el) {
      onChange(value + token);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label htmlFor={`msg-${field}`}>{t[`msg_${field}` as keyof typeof t] as string}</Label>
        <span className={`text-xs tabular-nums ${tooLong ? "text-destructive" : "text-muted-foreground"}`}>
          {value.length} / {TELEGRAM_TEXT_LIMIT}
        </span>
      </div>
      <Textarea
        id={`msg-${field}`}
        ref={ref}
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={tooLong || undefined}
      />
      {placeholders.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t.placeholderInsert}</span>
          {placeholders.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => insert(p)}
              dir="ltr"
              className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-muted/70"
            >
              {p}
            </button>
          ))}
        </div>
      )}
      {missing.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span>
            {t.placeholderMissing} <span dir="ltr" className="font-mono">{missing.join(" ")}</span>
          </span>
        </p>
      )}
    </div>
  );
}

export function TabMessages({ botId, data }: { botId: string; data: SettingsEnvelope }) {
  const t = useT("botSettings");
  const { toast } = useToast();
  const draft = useDraft<MessagesDraft>(`settings:messages:${botId}`, pick(data.settings));
  const patch = usePatchBotSettings(botId);

  const overLimit = MESSAGE_FIELDS.filter((f) => (draft.value[f] ?? "").length > TELEGRAM_TEXT_LIMIT);

  function save() {
    if (overLimit.length > 0) {
      toast({ variant: "destructive", title: t.tooLongTitle, description: t.tooLongDesc });
      return;
    }
    patch.mutate(draft.value as Partial<BotSettings>, {
      onSuccess: () => toast({ title: t.saved, description: data.cacheBust ? t.propagationFast : t.propagationSlow }),
    });
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t.messagesTitle}
          <Badge variant="secondary">{MESSAGE_FIELDS.length}</Badge>
        </CardTitle>
        <CardDescription>{t.messagesDesc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {MESSAGE_FIELDS.map((field) => (
          <MessageEditor
            key={field}
            field={field}
            value={draft.value[field] ?? ""}
            onChange={(next) => draft.set(field, next)}
          />
        ))}
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
  );
}
