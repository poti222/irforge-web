/**
 * TabReplyKeyboard.tsx — «کیبورد پایین» چت.
 * ─────────────────────────────────────────────────────────────────────────────
 * تا امروز بات فقط کیبورد **اینلاین** داشت: دکمه‌هایی که به یک پیام می‌چسبند
 * و با اسکرول‌شدن آن پیام از دسترس خارج می‌شوند. کیبورد پایین همیشه زیر دست
 * کاربر می‌ماند و همان چیزی است که اکثر بات‌ها به‌عنوان «منوی اصلی» دارند.
 *
 * ⚠️ این تنها بخشی از این دور رفع‌باگ است که **تغییر در خودِ بات** لازم داشت
 * (`handlers/user.py`)، چون `_render_panel` فقط `InlineKeyboardMarkup`
 * می‌ساخت و هیچ مسیری برای کیبورد پایین نداشت. دلیلش در PROGRESS.md ثبت شده.
 *
 * **چرا دکمه‌ها فقط متن‌اند و نه اکشن‌های کامل؟** دکمه‌ی ReplyKeyboard در
 * تلگرام هیچ payload ای ندارد؛ فقط متن خودش را می‌فرستد. اگر آن متن با `/`
 * شروع شود، تلگرام آن را کامند می‌فهمد و هندلر کامندهای سفارشیِ موجود
 * می‌گیردش. پس دکمه‌ای که واقعاً کاری می‌کند = دکمه‌ای که متنش یک کامند است،
 * و همین‌جا صریح گفته می‌شود.
 */
import type { Bot } from "@workspace/api-client-react";
import { Plus, Trash2, ArrowUp, ArrowDown, Keyboard, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/hooks/use-translation";
import { SettingsSaveBar, SettingsError, CachePropagationNotice } from "./SettingsSaveBar";
import { useDraft } from "./useDraft";
import { usePatchBotSettings, type BotSettings, type SettingsEnvelope } from "./api";

/** آینه‌ی سقف‌های سرور (`routes/botSettings.ts`). هر دو باید با هم عوض شوند. */
const MAX_ROWS = 10;
const MAX_PER_ROW = 4;

type KeyboardDraft = {
  enabled: boolean;
  rows: string[][];
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
    rows: kb?.rows?.length ? kb.rows.map((r) => [...r]) : [[""]],
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

  const rows = draft.value.rows;

  function setRows(next: string[][]) {
    draft.set("rows", next);
  }
  function setCell(rowIndex: number, colIndex: number, value: string) {
    setRows(rows.map((r, i) => (i === rowIndex ? r.map((c, j) => (j === colIndex ? value : c)) : r)));
  }
  function addCell(rowIndex: number) {
    if ((rows[rowIndex]?.length ?? 0) >= MAX_PER_ROW) return;
    setRows(rows.map((r, i) => (i === rowIndex ? [...r, ""] : r)));
  }
  function removeCell(rowIndex: number, colIndex: number) {
    const next = rows
      .map((r, i) => (i === rowIndex ? r.filter((_, j) => j !== colIndex) : r))
      // ردیفی که آخرین دکمه‌اش رفت، خودش هم می‌رود — یک ردیف خالی روی کیبورد
      // واقعی اصلاً وجود ندارد.
      .filter((r) => r.length > 0);
    setRows(next.length > 0 ? next : [[""]]);
  }
  function moveRow(from: number, delta: -1 | 1) {
    const to = from + delta;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    [next[from], next[to]] = [next[to], next[from]];
    setRows(next);
  }

  function save() {
    const cleaned = rows.map((r) => r.map((c) => c.trim()).filter(Boolean)).filter((r) => r.length > 0);
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
      { onSuccess: () => toast({ title: t.saved, description: data.cacheBust ? t.propagationFast : t.propagationSlow }) }
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
              <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{t.replyKeyboardCommandHint}</span>
              </p>

              <div className="space-y-3">
                {rows.map((row, rowIndex) => (
                  <div key={rowIndex} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {t.replyKeyboardRow.replace("{n}", String(rowIndex + 1))}
                      </span>
                      <div className="ms-auto flex gap-1">
                        <Button
                          variant="ghost" size="icon" className="size-7"
                          aria-label={t.replyKeyboardMoveUp}
                          disabled={rowIndex === 0}
                          onClick={() => moveRow(rowIndex, -1)}
                        >
                          <ArrowUp className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost" size="icon" className="size-7"
                          aria-label={t.replyKeyboardMoveDown}
                          disabled={rowIndex === rows.length - 1}
                          onClick={() => moveRow(rowIndex, 1)}
                        >
                          <ArrowDown className="size-3.5" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {row.map((cell, colIndex) => (
                        <div key={colIndex} className="flex min-w-40 flex-1 items-center gap-1">
                          <Input
                            value={cell}
                            maxLength={64}
                            placeholder={t.replyKeyboardButtonPlaceholder}
                            onChange={(e) => setCell(rowIndex, colIndex, e.target.value)}
                          />
                          <Button
                            variant="ghost" size="icon" className="size-8 shrink-0"
                            aria-label={t.replyKeyboardRemoveButton}
                            onClick={() => removeCell(rowIndex, colIndex)}
                          >
                            <Trash2 className="size-3.5 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>

                    {row.length < MAX_PER_ROW ? (
                      <Button variant="outline" size="sm" onClick={() => addCell(rowIndex)}>
                        <Plus className="me-1.5 size-3.5" /> {t.replyKeyboardAddButton}
                      </Button>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {t.replyKeyboardRowFull.replace("{max}", String(MAX_PER_ROW))}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {rows.length < MAX_ROWS && (
                <Button variant="outline" onClick={() => setRows([...rows, [""]])}>
                  <Plus className="me-1.5 size-4" /> {t.replyKeyboardAddRow}
                </Button>
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
                  {rows.filter((r) => r.some((c) => c.trim())).map((row, i) => (
                    <div key={i} className="flex gap-1">
                      {row.filter((c) => c.trim()).map((cell, j) => (
                        <span
                          key={j}
                          className="min-w-0 flex-1 truncate rounded-md bg-background px-2 py-2 text-center text-xs shadow-sm"
                        >
                          {cell}
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
