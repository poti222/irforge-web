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
import { useQuery } from "@tanstack/react-query";
import type { Bot } from "@workspace/api-client-react";
import { customFetch } from "@workspace/api-client-react";
import { Keyboard } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { SettingsSaveBar, SettingsError, CachePropagationNotice } from "./SettingsSaveBar";
import { useDraft } from "./useDraft";
import { usePatchBotSettings, type BotSettings, type SettingsEnvelope } from "./api";
import { ButtonBuilder } from "@/components/bots/panels/ButtonBuilder";
import { usePanels, usePanelCatalog, type PanelCatalog } from "@/components/bots/panels/api";
import type { PanelButton } from "@/lib/panel-buttons";

/** آینه‌ی سقفِ سرور (`routes/botSettings.ts::REPLY_KB_MAX_ROWS`). */
const MAX_ROWS = 10;

/**
 * زیرمجموعه‌ای از اکشن‌های دکمه‌ی پنل که کیبورد پایین پشتیبانی می‌کند — همان
 * `REPLY_KB_ACTIONS` سمت سرور. `catalog_order` و اکشن‌های ثابتِ پلاگینی
 * (رزرو نوبت و…) عمداً نیستند چون هندلرشان امروز فقط برای CallbackQuery
 * نوشته شده، نه برای resolve از روی متنِ یک پیام.
 */
const REPLY_KB_ACTIONS = ["text", "panel", "sell", "form", "mini_app", "url", "phone"];

/** رنگ‌های Bot API: سبز/قرمز/آبی. خالی = رنگ پیش‌فرض کلاینت. */
type Cell = { text: string; style: string; action: string; value: string };

function toCell(raw: unknown): Cell {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as { text?: unknown; style?: unknown; action?: unknown; value?: unknown };
    return {
      text: String(o.text ?? ""),
      style: String(o.style ?? ""),
      action: String(o.action ?? "") || "text",
      value: String(o.value ?? ""),
    };
  }
  return { text: String(raw ?? ""), style: "", action: "text", value: "" };
}

/** `Cell` ↔ `PanelButton` — همان شکلی که `ButtonBuilder` می‌فهمد.
 *  `row`/`col`/`row_start` هرگز خوانده نمی‌شوند (فقط برای فرمِ تختِ ذخیره‌ی
 *  پنل‌ها معنی دارند؛ اینجا مدل همیشه آرایه‌ی ردیف‌هاست)، پس مقدارِ ثابت کافی است. */
function cellToButton(c: Cell): PanelButton {
  return { label: c.text, action: c.action || "text", value: c.value, style: c.style, row: 0, col: 0, row_start: true };
}
function buttonToCell(b: PanelButton): Cell {
  return { text: b.label, style: b.style, action: b.action || "text", value: b.value };
}

function useFormOptions(botId: string) {
  return useQuery({
    queryKey: ["bot-forms-options", botId],
    queryFn: async () => {
      const res = await customFetch<{ forms: Array<{ id: string; title: string }> }>(`/api/bots/${botId}/forms`);
      return res.forms ?? [];
    },
  });
}

type KeyboardDraft = {
  enabled: boolean;
  rows: Cell[][];
  resize: boolean;
  one_time: boolean;
  placeholder: string;
};

function pick(settings: BotSettings): KeyboardDraft {
  const kb = settings.reply_keyboard;
  return {
    // روی شیت، «خاموش» با `null` بیان می‌شود — یک فیلد `enabled` جدا وجود
    // ندارد. اینجا به یک سوئیچ ترجمه می‌شود تا کاربر برای خاموش‌کردن مجبور
    // نباشد همه‌ی دکمه‌هایش را پاک کند.
    enabled: Boolean(kb && kb.rows?.length),
    rows: kb?.rows?.length ? kb.rows.map((r) => r.map(toCell)) : [[toCell("")]],
    resize: kb?.resize ?? true,
    one_time: kb?.one_time ?? false,
    placeholder: kb?.placeholder ?? "",
  };
}

export function TabReplyKeyboard({ bot, data }: { bot: Bot; data: SettingsEnvelope }) {
  const t = useT("botSettings");
  const { toast } = useToast();
  const draft = useDraft<KeyboardDraft>(`settings:replyKeyboard:${bot.id}`, pick(data.settings));
  const patch = usePatchBotSettings(bot.id);

  const { data: panelsData } = usePanels(bot.id);
  const { data: forms = [] } = useFormOptions(bot.id);
  const { data: catalog } = usePanelCatalog(bot.id);

  // همان کاتالوگِ پنل‌ها، فقط با فهرستِ اکشن محدود به زیرمجموعه‌ی امنِ کیبورد
  // پایین — و «متن آزاد» بدون فیلدِ مقدار (مثل phone، از buttonFixedValues).
  const restrictedCatalog: PanelCatalog | undefined = catalog
    ? {
        ...catalog,
        buttonActions: REPLY_KB_ACTIONS.filter((a) => a === "text" || catalog.buttonActions.includes(a)),
        buttonFixedValues: { ...(catalog.buttonFixedValues ?? {}), text: "" },
      }
    : { panelTypes: [], buttonActions: REPLY_KB_ACTIONS, buttonFixedValues: { text: "" }, buttonStyles: ["", "primary", "success", "danger"], multiMediaTypes: [], textOnlyTypes: [], maxButtonsPerRow: 4 };

  const rows = draft.value.rows;
  const buttonRows = rows.map((row) => row.map(cellToButton));

  function setButtonRows(next: PanelButton[][]) {
    // سقفِ ردیفِ کیبورد پایین — چیزی که خودِ ButtonBuilder (که برای پنل‌های
    // بدون این سقف ساخته شده) نمی‌داند. رسیدن به سقف یعنی «افزودنِ ردیف»
    // بی‌اثر می‌ماند، نه خطا — هشدارِ متنیِ زیرِ آن همین را می‌گوید.
    if (next.length > MAX_ROWS) return;
    draft.set("rows", next.map((row) => row.map(buttonToCell)));
  }

  function save() {
    // دکمه‌ی بی‌رنگ/بی‌اکشن به همان رشته‌ی ساده برمی‌گردد — تا کیبوردهای
    // موجود بی‌دلیل به شکل سنگین‌تر بازنویسی نشوند. «متن آزاد» هم دقیقاً
    // همین رفتارِ اصلی است، پس روی ذخیره به «بدونِ اکشن» نرمال می‌شود.
    const cleaned = rows
      .map((r) =>
        r
          .map((c) => ({
            text: c.text.trim(),
            style: c.style,
            action: c.action === "text" ? "" : c.action,
            value: c.value,
          }))
          .filter((c) => c.text)
          .map((c) => {
            if (!c.style && !c.action) return c.text;
            const obj: Record<string, string> = { text: c.text };
            if (c.style) obj.style = c.style;
            if (c.action) {
              obj.action = c.action;
              obj.value = c.value;
            }
            return obj;
          })
      )
      .filter((r) => r.length > 0);
    patch.mutate(
      {
        reply_keyboard: draft.value.enabled && cleaned.length > 0
          ? {
              rows: cleaned,
              resize: draft.value.resize,
              one_time: draft.value.one_time,
              placeholder: draft.value.placeholder.trim(),
            }
          : null,
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

              <ButtonBuilder
                botId={bot.id}
                rows={buttonRows}
                panels={panelsData?.panels ?? []}
                forms={forms}
                catalog={restrictedCatalog}
                onChange={setButtonRows}
              />
              {rows.length >= MAX_ROWS && (
                <p className="text-xs text-muted-foreground">
                  {t.replyKeyboardMaxRowsReached.replace("{max}", String(MAX_ROWS))}
                </p>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="rk-placeholder">{t.replyKeyboardPlaceholder}</Label>
                <Input
                  id="rk-placeholder"
                  maxLength={64}
                  value={draft.value.placeholder}
                  onChange={(e) => draft.set("placeholder", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t.replyKeyboardPlaceholderHint}</p>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <Label htmlFor="rk-resize">{t.replyKeyboardResize}</Label>
                  <p className="text-xs text-muted-foreground">{t.replyKeyboardResizeHint}</p>
                </div>
                <Switch id="rk-resize" checked={draft.value.resize} onCheckedChange={(v) => draft.set("resize", v)} />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <Label htmlFor="rk-onetime">{t.replyKeyboardOneTime}</Label>
                  <p className="text-xs text-muted-foreground">{t.replyKeyboardOneTimeHint}</p>
                </div>
                <Switch id="rk-onetime" checked={draft.value.one_time} onCheckedChange={(v) => draft.set("one_time", v)} />
              </div>

              {/* پیش‌نمایش — همان چیدمانی که کاربر زیر کادر پیام می‌بیند. */}
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">{t.replyKeyboardPreview}</p>
                <div className="space-y-1">
                  {rows.filter((r) => r.some((c) => c.text.trim())).map((row, i) => (
                    <div key={i} className="flex gap-1">
                      {row.filter((c) => c.text.trim()).map((cell, j) => (
                        <span
                          key={j}
                          className={`min-w-0 flex-1 truncate rounded-md px-2 py-2 text-center text-xs shadow-sm ${
                            cell.style === "success"
                              ? "bg-emerald-600 text-white"
                              : cell.style === "danger"
                                ? "bg-rose-600 text-white"
                                : cell.style === "primary"
                                  ? "bg-sky-600 text-white"
                                  : "bg-background"
                          }`}
                        >
                          {cell.text}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
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
