import { AlertTriangle, Info } from "lucide-react";
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

/** رنگ متن/آیکون متناظر با همان مقیاس. */
export const SEVERITY_TEXT_CLASS: Record<Severity, string> = {
  critical: "text-red-500",
  warning: "text-amber-500",
  info: "text-primary",
};

/** نوار هدر صفحه‌ی جزئیات — پس‌زمینه‌ی کم‌رنگ + حاشیه‌ی هم‌خانواده. */
export const SEVERITY_STRIP_CLASS: Record<Severity, string> = {
  critical: "border-red-500/40 bg-red-500/10",
  warning: "border-amber-500/40 bg-amber-500/10",
  info: "border-primary/40 bg-primary/10",
};

/** رنگ نشانگر برای بالاترین severityِ خوانده‌نشده؛ `null` یعنی چیزی برای نشان دادن نیست. */
export function severityDotClass(severity: Severity | null): string | null {
  return severity ? SEVERITY_DOT_CLASS[severity] : null;
}

/**
 * آیکون متناظر با severity. قبلاً داخل `notification-bell.tsx` بود؛ حالا لیست
 * اعلان‌ها و صفحه‌ی جزئیات هم از همین استفاده می‌کنند (به‌جای کپی‌کردن).
 */
export function severityIcon(severity: Severity, className = "size-4 shrink-0") {
  if (severity === "critical") return <AlertTriangle className={`${className} ${SEVERITY_TEXT_CLASS.critical}`} />;
  if (severity === "warning") return <AlertTriangle className={`${className} ${SEVERITY_TEXT_CLASS.warning}`} />;
  return <Info className={`${className} ${SEVERITY_TEXT_CLASS.info}`} />;
}

/**
 * لینکِ «کارِ بعدی» برای هر نوع اعلان — از روی `type` مشتق می‌شود، چون
 * جدول اعلان‌ها جایی برای URL ندارد.
 */
export function ctaForType(
  type: string,
  refId?: string | null,
  botId?: string | null,
): { href: string; key: "tickets" | "invoices" | "buyBot" | "wallet" | "bots" | "update" } | null {
  // اول از همه: اعلانِ آپدیت سایت به خودِ آن آپدیت لینک می‌دهد. تنها نوعی که
  // مقصدش به یک رکورد مشخص وابسته است، نه فقط به type.
  if (type === "site_update" && refId) return { href: `/updates/${refId}`, key: "update" };
  // IRFORGE_PROMPT_V3 Phase 16 — تیکتِ داخلِ *بات*، نه دسکِ پشتیبانیِ سایت
  // (`ticket_*` پایین‌تر) — مقصدش سکشن تیکت‌های همان بات است.
  if (type === "bot_new_ticket" || type === "bot_ticket_escalated") {
    return { href: botId ? `/bots/${botId}?section=tickets` : "/bots", key: "bots" };
  }
  if (type.startsWith("ticket_")) return { href: "/tickets", key: "tickets" };
  if (type.startsWith("purchase_") || type.startsWith("payment_") || type.startsWith("order_")) {
    return { href: "/invoices", key: "invoices" };
  }
  if (type.startsWith("trial_")) return { href: "/buy-bot", key: "buyBot" };
  if (type.startsWith("deposit_")) return { href: "/wallet", key: "wallet" };
  if (type === "plugin_purchased") return { href: "/bots", key: "bots" };
  return null;
}
