import crypto from "crypto";
import { logger } from "./logger.js";

/**
 * Verifies the payload returned by Telegram's official Login Widget.
 * https://core.telegram.org/widgets/login#checking-authorization
 *
 * IMPORTANT: this only ever gives you id / first_name / last_name / username /
 * photo_url / auth_date. Telegram never exposes the user's phone number through
 * this widget — that requires a separate bot-side "request contact" flow inside
 * an actual Telegram chat. Don't build UI that promises a phone number from this
 * alone.
 */
export interface TelegramAuthPayload {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60; // 1 day

export function verifyTelegramAuth(
  payload: TelegramAuthPayload,
  botToken: string
): { ok: true } | { ok: false; reason: string } {
  const { hash, ...rest } = payload;
  if (!hash) return { ok: false, reason: "Missing hash" };

  const dataCheckString = Object.keys(rest)
    .sort()
    .filter((key) => (rest as Record<string, unknown>)[key] !== undefined)
    .map((key) => `${key}=${(rest as Record<string, unknown>)[key]}`)
    .join("\n");

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (computedHash !== hash) {
    logger.warn({ telegramId: payload.id }, "Telegram auth hash mismatch");
    return { ok: false, reason: "Invalid hash — this request did not come from Telegram" };
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - payload.auth_date;
  if (ageSeconds > MAX_AUTH_AGE_SECONDS) {
    return { ok: false, reason: "Auth payload expired, please try again" };
  }

  return { ok: true };
}

/**
 * Verifies Telegram Mini App initData.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export interface TelegramMiniAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

export function verifyTelegramInitData(
  initData: string,
  botToken: string
): { ok: true; user: TelegramMiniAppUser } | { ok: false; reason: string } {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { ok: false, reason: "Missing hash" };

    // ساخت data-check-string
    params.delete("hash");
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    // کلید HMAC-SHA256 با "WebAppData" به عنوان key
    const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
    const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    if (computedHash !== hash) {
      return { ok: false, reason: "Invalid hash" };
    }

    // چک کردن auth_date (نباید بیشتر از ۱ روز پیش باشه)
    const authDate = Number(params.get("auth_date") ?? 0);
    const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
    if (ageSeconds > 86400) {
      return { ok: false, reason: "Auth data expired" };
    }

    const userStr = params.get("user");
    if (!userStr) return { ok: false, reason: "Missing user data" };

    const user: TelegramMiniAppUser = JSON.parse(userStr);
    return { ok: true, user };
  } catch (e) {
    return { ok: false, reason: "Failed to parse initData" };
  }
}
