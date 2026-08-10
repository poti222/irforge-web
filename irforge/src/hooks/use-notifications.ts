import { customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * سیستم اعلان‌های جدید سایت (اولین مصرف: هشدارهای تریال ۷ روزه).
 * چون سرور cron ندارد، هر بار این هوک fetch می‌کند سمت بک‌اند وضعیت
 * تریال‌های کاربر را دوباره ارزیابی می‌کند (ببین api-server/src/lib/trial.ts) —
 * یعنی صرفِ باز بودن سایت باعث ساخته‌شدن اعلان‌های جدید در روز مناسب می‌شود.
 */
export type AppNotification = {
  id: string;
  botId: string | null;
  type: string; // "trial_warning" | "trial_expired" | ...
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  read: boolean;
  /**
   * ارجاع اختیاری به رکورد مرتبط. فعلاً فقط برای type = "site_update" پر
   * می‌شود و id همان آپدیت است، تا لینک /updates/:id ساخته شود.
   */
  refId: string | null;
  createdAt: string;
};

const NOTIFICATIONS_KEY = ["notifications"];

export function useNotifications() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => customFetch<AppNotification[]>("/api/notifications"),
    // W3: مثل موجودی کیف پول تو cart-button، هر یک دقیقه دوباره چک می‌کنیم
    // تا هشدار روز جدید بدون رفرش دستی ظاهر بشه.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const unread = (query.data ?? []).filter((n) => !n.read);
  const unreadCount = unread.length;

  /**
   * بالاترین severity بین اعلان‌های خوانده‌نشده — رنگ نشانگر (بج زنگوله و نقطه‌ی
   * کنار منوی کناری) از روی همین تعیین می‌شود. وقتی چیزی خوانده‌نشده نیست
   * `null` است.
   */
  const topSeverity: AppNotification["severity"] | null =
    unreadCount === 0
      ? null
      : unread.some((n) => n.severity === "critical")
        ? "critical"
        : unread.some((n) => n.severity === "warning")
          ? "warning"
          : "info";

  async function markRead(id: string) {
    await customFetch(`/api/notifications/${id}/read`, { method: "PATCH" });
    queryClient.setQueryData<AppNotification[]>(NOTIFICATIONS_KEY, (prev) =>
      (prev ?? []).map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }

  async function markAllRead() {
    await customFetch("/api/notifications/read-all", { method: "POST" });
    queryClient.setQueryData<AppNotification[]>(NOTIFICATIONS_KEY, (prev) =>
      (prev ?? []).map((n) => ({ ...n, read: true }))
    );
  }

  return {
    notifications: query.data ?? [],
    unreadCount,
    topSeverity,
    isLoading: query.isLoading,
    markRead,
    markAllRead,
  };
}
