/**
 * ReplyKeyboardFields.tsx — ویرایشگرِ «کیبورد پایین» (ReplyKeyboard)، مشترک بین
 *   ۱) تنظیمات بات (کیبوردِ سراسری — `settings/TabReplyKeyboard.tsx`) و
 *   ۲) هر پنل (کیبوردِ مخصوصِ همان پنل — تبِ «کیبورد پایین» در `panels/PanelEditor.tsx`).
 *
 * **همان سیستمِ دکمه‌ی پنل، عیناً:** `ButtonBuilder` با زیرمجموعه‌ی امنِ اکشن‌ها (کیبورد پایین در تلگرام payload ندارد؛
 * فقط متنِ خودش را می‌فرستد، پس اکشن‌هایی که فقط با CallbackQuery معنی دارند اینجا نیستند). شکلِ ذخیره‌شده همانی است
 * که `handlers/user.py::_build_reply_keyboard` در بات می‌خواند و `lib/replyKeyboard.ts` سمتِ سرور اعتبارسنجی می‌کند.
 */
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/use-translation";
import { ButtonBuilder } from "@/components/bots/panels/ButtonBuilder";
import { usePanels, usePanelCatalog, type PanelCatalog } from "@/components/bots/panels/api";
import type { PanelButton } from "@/lib/panel-buttons";

/** آینه‌ی سقفِ سرور (`lib/replyKeyboard.ts::REPLY_KB_MAX_ROWS`). */
export const RK_MAX_ROWS = 10;

/**
 * زیرمجموعه‌ای از اکشن‌های دکمه‌ی پنل که کیبورد پایین پشتیبانی می‌کند — همان `REPLY_KB_ACTIONS` سمت سرور.
 * `catalog_order` و اکشن‌های ثابتِ پلاگینی عمداً نیستند (هندلرشان فقط برای CallbackQuery نوشته شده).
 */
const RK_ACTIONS = ["text", "panel", "sell", "form", "mini_app", "url", "phone"];

export type RkCell = { text: string; style: string; action: string; value: string };
export type RkDraft = { rows: RkCell[][]; resize: boolean; one_time: boolean; placeholder: string };

function toCell(raw: unknown): RkCell {
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

/** کیبوردِ ذخیره‌شده (یا `null`) → پیش‌نویسِ قابلِ ویرایش. همیشه حداقل یک خانه‌ی خالی برای شروع. */
export function rkToDraft(raw: unknown): RkDraft {
  const kb = raw && typeof raw === "object" ? (raw as { rows?: unknown[][]; resize?: boolean; one_time?: boolean; placeholder?: string }) : null;
  return {
    rows: kb?.rows?.length ? kb.rows.map((r) => r.map(toCell)) : [[toCell("")]],
    resize: kb?.resize ?? true,
    one_time: kb?.one_time ?? false,
    placeholder: kb?.placeholder ?? "",
  };
}

/**
 * پیش‌نویس → شکلِ ذخیره‌شده. دکمه‌ی بی‌رنگ/بی‌اکشن به همان رشته‌ی ساده برمی‌گردد (تا کیبوردهای موجود بی‌دلیل
 * سنگین‌تر بازنویسی نشوند)؛ «متن آزاد» هم همان رفتارِ اصلی است. بدونِ هیچ دکمه‌ای → `null`.
 */
export function rkSerialize(draft: RkDraft): { rows: unknown[][]; resize: boolean; one_time: boolean; placeholder: string } | null {
  const rows = draft.rows
    .map((r) =>
      r
        .map((c) => ({ text: c.text.trim(), style: c.style, action: c.action === "text" ? "" : c.action, value: c.value }))
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
  if (rows.length === 0) return null;
  return { rows, resize: draft.resize, one_time: draft.one_time, placeholder: draft.placeholder.trim() };
}

function cellToButton(c: RkCell): PanelButton {
  return { label: c.text, action: c.action || "text", value: c.value, style: c.style, row: 0, col: 0, row_start: true };
}
function buttonToCell(b: PanelButton): RkCell {
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

export function ReplyKeyboardFields({
  botId,
  value,
  onChange,
  idPrefix = "rk",
}: {
  botId: string;
  value: RkDraft;
  onChange: (patch: Partial<RkDraft>) => void;
  idPrefix?: string;
}) {
  const t = useT("botSettings");
  const { data: panelsData } = usePanels(botId);
  const { data: forms = [] } = useFormOptions(botId);
  const { data: catalog } = usePanelCatalog(botId);

  // همان کاتالوگِ پنل‌ها، فقط با فهرستِ اکشنِ محدود — و «متن آزاد» بدونِ فیلدِ مقدار (مثل phone).
  const restrictedCatalog: PanelCatalog = catalog
    ? {
        ...catalog,
        buttonActions: RK_ACTIONS.filter((a) => a === "text" || catalog.buttonActions.includes(a)),
        buttonFixedValues: { ...(catalog.buttonFixedValues ?? {}), text: "" },
      }
    : { panelTypes: [], buttonActions: RK_ACTIONS, buttonFixedValues: { text: "" }, buttonStyles: ["", "primary", "success", "danger"], multiMediaTypes: [], textOnlyTypes: [], maxButtonsPerRow: 4 };

  const rows = value.rows;
  const buttonRows = rows.map((row) => row.map(cellToButton));

  function setButtonRows(next: PanelButton[][]) {
    // سقفِ ردیفِ کیبورد پایین — چیزی که خودِ ButtonBuilder نمی‌داند. رسیدن به سقف یعنی «افزودنِ ردیف» بی‌اثر می‌ماند.
    if (next.length > RK_MAX_ROWS) return;
    onChange({ rows: next.map((row) => row.map(buttonToCell)) });
  }

  return (
    <>
      <ButtonBuilder
        botId={botId}
        rows={buttonRows}
        panels={panelsData?.panels ?? []}
        forms={forms}
        catalog={restrictedCatalog}
        onChange={setButtonRows}
      />
      {rows.length >= RK_MAX_ROWS && (
        <p className="text-xs text-muted-foreground">{t.replyKeyboardMaxRowsReached.replace("{max}", String(RK_MAX_ROWS))}</p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-placeholder`}>{t.replyKeyboardPlaceholder}</Label>
        <Input
          id={`${idPrefix}-placeholder`}
          maxLength={64}
          value={value.placeholder}
          onChange={(e) => onChange({ placeholder: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">{t.replyKeyboardPlaceholderHint}</p>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border p-3">
        <div className="min-w-0">
          <Label htmlFor={`${idPrefix}-resize`}>{t.replyKeyboardResize}</Label>
          <p className="text-xs text-muted-foreground">{t.replyKeyboardResizeHint}</p>
        </div>
        <Switch id={`${idPrefix}-resize`} checked={value.resize} onCheckedChange={(v) => onChange({ resize: v })} />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border p-3">
        <div className="min-w-0">
          <Label htmlFor={`${idPrefix}-onetime`}>{t.replyKeyboardOneTime}</Label>
          <p className="text-xs text-muted-foreground">{t.replyKeyboardOneTimeHint}</p>
        </div>
        <Switch id={`${idPrefix}-onetime`} checked={value.one_time} onCheckedChange={(v) => onChange({ one_time: v })} />
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
  );
}
