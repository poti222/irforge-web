/**
 * PanelReplyKeyboardTab.tsx — «کیبورد پایین» مخصوصِ یک پنل.
 *
 * ادمین می‌تواند برای هر پنل جدا مشخص کند وقتی کاربر آن را باز می‌کند، کیبوردِ پایینِ چت چه شود
 * (`panel.settings.reply_keyboard`، اعتبارسنجی در `lib/replyKeyboard.ts`، رندر در `handlers/user.py::_render_panel`):
 *   keep    — دست نزن؛ کیبوردِ فعلیِ کاربر می‌ماند (پیش‌فرض؛ نبودنِ کلید)
 *   custom  — کیبوردِ اختصاصیِ همین پنل
 *   default — برگرداندنِ کیبوردِ اصلیِ بات (تنظیمات ← کیبورد پایین)
 *   hide    — حذفِ کیبورد
 */
import { Keyboard } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { ReplyKeyboardFields, rkToDraft, rkSerialize, type RkDraft } from "@/components/bots/ReplyKeyboardFields";

export type PanelRkMode = "keep" | "custom" | "default" | "hide";
export type PanelRkState = { mode: PanelRkMode; draft: RkDraft; message: string };

/** `panel.settings.reply_keyboard` (یا نبودنش) → state ویرایشگر. */
export function panelRkFromSettings(settings: Record<string, unknown> | undefined): PanelRkState {
  const raw = settings?.reply_keyboard as { mode?: string; message?: string } | undefined;
  const mode = raw && ["custom", "default", "hide"].includes(String(raw.mode)) ? (raw.mode as PanelRkMode) : "keep";
  return { mode, draft: rkToDraft(mode === "custom" ? raw : null), message: String(raw?.message ?? "") };
}

/** state → مقدارِ ذخیره‌شده (یا `undefined` = «تنظیمی نیست»، کلید حذف می‌شود). */
export function panelRkToSettings(state: PanelRkState): Record<string, unknown> | undefined {
  const message = state.message.trim();
  const extra = message ? { message } : {};
  if (state.mode === "default" || state.mode === "hide") return { mode: state.mode, ...extra };
  if (state.mode === "custom") {
    const kb = rkSerialize(state.draft);
    return kb ? { mode: "custom", ...kb, ...extra } : undefined;
  }
  return undefined;
}

export function PanelReplyKeyboardTab({
  botId,
  state,
  onChange,
}: {
  botId: string;
  state: PanelRkState;
  onChange: (next: PanelRkState) => void;
}) {
  const t = useT("botPanels");
  const empty = state.mode === "custom" && !rkSerialize(state.draft);
  const hint =
    state.mode === "keep" ? t.rkHintKeep
    : state.mode === "custom" ? t.rkHintCustom
    : state.mode === "default" ? t.rkHintDefault
    : t.rkHintHide;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Keyboard className="size-4" /></span>
          <p className="text-sm text-muted-foreground">{t.rkIntro}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pe-rk-mode">{t.rkModeLabel}</Label>
          <Select value={state.mode} onValueChange={(v) => onChange({ ...state, mode: v as PanelRkMode })}>
            <SelectTrigger id="pe-rk-mode" data-testid="panel-rk-mode"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="keep">{t.rkModeKeep}</SelectItem>
              <SelectItem value="custom">{t.rkModeCustom}</SelectItem>
              <SelectItem value="default">{t.rkModeDefault}</SelectItem>
              <SelectItem value="hide">{t.rkModeHide}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>

        {state.mode === "custom" && (
          <ReplyKeyboardFields
            botId={botId}
            idPrefix="pe-rk"
            value={state.draft}
            onChange={(patch) => onChange({ ...state, draft: { ...state.draft, ...patch } })}
          />
        )}
        {empty && <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">{t.rkEmptyCustom}</p>}

        {state.mode !== "keep" && (
          <div className="space-y-1.5">
            <Label htmlFor="pe-rk-message">{t.rkMessageLabel}</Label>
            <Input
              id="pe-rk-message"
              maxLength={100}
              value={state.message}
              placeholder="⌨️"
              onChange={(e) => onChange({ ...state, message: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t.rkMessageHint}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
