/**
 * labels.ts — برچسب انواع پنل و اکشن دکمه.
 *
 * انواعِ هسته کلید locale دارند؛ انواعی که پلاگین‌ها ثبت می‌کنند کلید ندارند و
 * خودِ شناسه نمایش داده می‌شود — بهتر از اینکه سایت جلوی یک نوع معتبر را بگیرد
 * یا «نامعتبر» نشانش دهد.
 */
import type { LocaleShape } from "@/hooks/use-translation";

type PanelsLocale = LocaleShape["botPanels"];

export function panelTypeLabel(t: PanelsLocale, type: string): string {
  const key = `type_${type}` as keyof PanelsLocale;
  const label = t[key];
  return typeof label === "string" ? label : type;
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
