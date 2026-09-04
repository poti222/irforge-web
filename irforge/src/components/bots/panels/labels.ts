/**
 * labels.ts — برچسب انواع پنل و اکشن دکمه.
 *
 * انواعِ هسته و انواعِ پلاگینیِ شناخته‌شده کلید locale دارند
 * (`type_wallet`, `type_ticket`, ...  — IRFORGE_WEB_LIST_SYNC_PROMPT فاز ۱).
 * برای نوعِ پلاگینیِ *تازه‌ای* که هنوز کلید locale برایش اضافه نشده،
 * `pluginLabels` (همان `panelTypeLabels`ی که `/panel-catalog` برمی‌گرداند —
 * برچسبِ فارسیِ خودِ بات) fallback بعدی است؛ خودِ شناسه‌ی خام آخرین fallback
 * است — بهتر از اینکه سایت جلوی یک نوع معتبر را بگیرد یا «نامعتبر» نشانش دهد.
 */
import type { LocaleShape } from "@/hooks/use-translation";

type PanelsLocale = LocaleShape["botPanels"];

export function panelTypeLabel(t: PanelsLocale, type: string, pluginLabels?: Record<string, string>): string {
  const key = `type_${type}` as keyof PanelsLocale;
  const label = t[key];
  if (typeof label === "string") return label;
  return pluginLabels?.[type] ?? type;
}

export function buttonActionLabel(t: PanelsLocale, action: string): string {
  const key = `action_${action}` as keyof PanelsLocale;
  const label = t[key];
  return typeof label === "string" ? label : action;
}

export function buttonStyleLabel(t: PanelsLocale, style: string): string {
  if (!style) return t.styleDefault;
  const key = `style_${style}` as keyof PanelsLocale;
  const label = t[key];
  return typeof label === "string" ? label : style;
}
