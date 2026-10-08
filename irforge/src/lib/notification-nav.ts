import type { AppNotification } from "@/hooks/use-notifications";

/**
 * هر اعلان فقط کنار «مرتبط‌ترین» آیتمِ منوی کناری نقطه می‌اندازد (نه همه‌ی آیتم‌ها):
 *   تیکت → تیکت‌ها · خرید/وضعیتِ بات و پلن → ربات‌های من · شارژ/رد/تأییدِ واریز → کیف پول و فاکتورها · آپدیت → آپدیت‌ها.
 * بقیه‌ی اعلان‌ها (نقش، رمز، …) فقط در زنگوله‌ی بالای صفحه می‌مانند.
 */
export type NavDotKey = "tickets" | "bots" | "billing" | "updates";

const PREFIX: Array<[string, NavDotKey]> = [
  ["ticket_", "tickets"],
  ["tier_", "bots"],
  ["sql_database_", "bots"],
  ["trial_", "bots"],
  ["bot_", "bots"],
];

const EXACT: Record<string, NavDotKey> = {
  purchase_success: "bots",
  purchase_failed: "bots",
  plugin_purchased: "bots",
  status_changed: "bots",
  telegram_reset: "bots",
  plan_adjusted: "bots",
  wallet_topup_confirmed: "billing",
  school_wallet_topup_confirmed: "billing",
  deposit_approved: "billing",
  deposit_rejected: "billing",
  payment_approved: "billing",
  payment_rejected: "billing",
  order_cancelled: "billing",
  site_update: "updates",
  plugin_release_note: "updates",
};

export function navKeyForNotification(type: string): NavDotKey | null {
  if (type in EXACT) return EXACT[type];
  for (const [p, k] of PREFIX) if (type.startsWith(p)) return k;
  return null;
}

const RANK = { info: 0, warning: 1, critical: 2 } as const;

/** بالاترین severityِ اعلان‌های خوانده‌نشده‌ی هر آیتم؛ آیتمی که اعلان ندارد در نتیجه نیست. */
export function navDotSeverities(notifications: AppNotification[]): Partial<Record<NavDotKey, AppNotification["severity"]>> {
  const out: Partial<Record<NavDotKey, AppNotification["severity"]>> = {};
  for (const n of notifications) {
    if (n.read) continue;
    const key = navKeyForNotification(n.type);
    if (!key) continue;
    const cur = out[key];
    if (!cur || RANK[n.severity] > RANK[cur]) out[key] = n.severity;
  }
  return out;
}

/** مسیرِ صفحه ← کلیدِ نقطه‌ای که با باز شدنِ آن صفحه «دیده‌شده» حساب می‌شود. */
export function navKeyForPath(path: string): NavDotKey | null {
  if (path === "/tickets") return "tickets";
  if (path.startsWith("/bots")) return "bots";
  if (path === "/wallet" || path === "/invoices") return "billing";
  if (path.startsWith("/updates")) return "updates";
  return null;
}
