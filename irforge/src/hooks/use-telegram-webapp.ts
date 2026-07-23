/**
 * Hook for accessing Telegram Mini App data.
 * When the app runs inside Telegram, WebApp.initDataUnsafe.user
 * contains the current user's info automatically — no login widget needed.
 */

export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

export function useTelegramWebApp() {
  const tg = (window as any).Telegram?.WebApp;

  const isInsideTelegram = Boolean(tg?.initData && tg.initData.length > 0);
  const user: TelegramWebAppUser | null = tg?.initDataUnsafe?.user ?? null;
  const initData: string = tg?.initData ?? "";

  function ready() {
    tg?.ready();
  }

  function expand() {
    tg?.expand();
  }

  return {
    isInsideTelegram,
    user,
    initData,
    ready,
    expand,
    tg,
  };
}
