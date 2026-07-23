import { useEffect, useRef } from "react";

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramWidgetUser) => void;
  }
}

export interface TelegramWidgetUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

interface TelegramLoginButtonProps {
  botUsername: string;
  onAuth: (user: TelegramWidgetUser) => void;
  size?: "large" | "medium" | "small";
}

/**
 * Renders the official Telegram Login Widget.
 * Requires VITE_TELEGRAM_BOT_USERNAME to be set (the @username of the bot
 * configured for login — see https://core.telegram.org/widgets/login).
 *
 * This only ever returns id / first_name / last_name / username / photo_url.
 * Telegram does NOT share phone numbers through this widget.
 */
export function TelegramLoginButton({ botUsername, onAuth, size = "large" }: TelegramLoginButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.onTelegramAuth = onAuth;

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", size);
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");

    containerRef.current?.appendChild(script);

    return () => {
      delete window.onTelegramAuth;
      if (containerRef.current?.contains(script)) {
        containerRef.current.removeChild(script);
      }
    };
  }, [botUsername, size, onAuth]);

  return <div ref={containerRef} data-testid="telegram-login-widget" />;
}
