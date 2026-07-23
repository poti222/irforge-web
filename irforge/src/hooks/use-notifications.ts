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

  const unreadCount = (query.data ?? []).filter((n) => !n.read).length;

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
    isLoading: query.isLoading,
    markRead,
    markAllRead,
  };
}
