import type { AppNotification } from "@/hooks/use-notifications";

export type Severity = AppNotification["severity"];

/**
 * یک مقیاس رنگ برای همه‌ی نشانگرهای اعلان — بج زنگوله، نقطه‌ی کنار آیتم‌های
 * منوی کناری و آواتار فوتر. در یک جا نگه داشته می‌شود تا سه‌جا از هم جدا نیفتند.
 */
export const SEVERITY_DOT_CLASS: Record<Severity, string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-primary",
};

/** رنگ نشانگر برای بالاترین severityِ خوانده‌نشده؛ `null` یعنی چیزی برای نشان دادن نیست. */
export function severityDotClass(severity: Severity | null): string | null {
  return severity ? SEVERITY_DOT_CLASS[severity] : null;
}
