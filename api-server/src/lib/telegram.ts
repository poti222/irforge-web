import crypto from "crypto";
import { logger } from "./logger";

/**
 * Send a Telegram message through a given bot token.
 *
 * Factored out of bots.ts so both the tenant-bot flows (approve payment,
 * regenerate admin code) and the platform-bot flow (V2 password recovery) call
 * the same helper with different tokens — instead of duplicating the fetch.
 * Non-fatal: a delivery failure is logged, not thrown.
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (err) {
    logger.warn({ err }, "sendTelegramMessage failed (non-fatal)");
  }
}

// ─── G8: connect-via-bot (webhook + file proxy) ────────────────────────────

export async function tgApi<T = any>(
  botToken: string,
  method: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; result?: T; description?: string }> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return (await res.json()) as { ok: boolean; result?: T; description?: string };
}

/**
 * setMyProfilePhoto (added to Bot API mid-2026, see
 * https://core.telegram.org/bots/api#setmyprofilephoto) takes multipart/form-data
 * with a real file, unlike the rest of the JSON-only Bot API — so it can't
 * reuse tgApi() above. Uses Node's built-in FormData/Blob (Node 18+, no new
 * dependency).
 */
export async function tgSetProfilePhoto(
  botToken: string,
  photoBuffer: Buffer,
  mimeType: string
): Promise<{ ok: boolean; description?: string }> {
  const form = new FormData();
  form.set("photo", JSON.stringify({ type: "static", photo: "attach://photo_file" }));
  form.set("photo_file", new Blob([photoBuffer], { type: mimeType }), "profile.jpg");
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setMyProfilePhoto`, {
    method: "POST",
    body: form,
  });
  return (await res.json()) as { ok: boolean; description?: string };
}

/**
 * Deterministic per-bot-token secret used both to register the webhook
 * (`secret_token`) and to validate the `X-Telegram-Bot-Api-Secret-Token`
 * header on incoming updates. Deriving it from the bot token means it's
 * stable across restarts/instances without needing a separate env var, and
 * it's never sent anywhere except to Telegram itself.
 */
export function telegramWebhookSecret(botToken: string): string {
  return crypto.createHash("sha256").update(`${botToken}:irforge_webhook_secret`).digest("hex");
}

/**
 * Registers the platform bot's webhook with Telegram, if TELEGRAM_BOT_TOKEN
 * and PUBLIC_SITE_URL are both configured. Safe to call on every boot —
 * setWebhook is idempotent. Never throws (best-effort, logged).
 */
export async function registerTelegramWebhookIfConfigured(): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const siteUrl = process.env.PUBLIC_SITE_URL;
  if (!botToken || !siteUrl) {
    logger.info(
      "Telegram webhook not registered (TELEGRAM_BOT_TOKEN and/or PUBLIC_SITE_URL missing) — 'connect via bot' will be unavailable"
    );
    return;
  }
  const url = `${siteUrl.replace(/\/+$/, "")}/api/telegram/webhook`;
  try {
    const result = await tgApi(botToken, "setWebhook", {
      url,
      secret_token: telegramWebhookSecret(botToken),
      allowed_updates: ["message"],
    });
    if (result.ok) {
      logger.info({ url }, "Telegram webhook registered");
    } else {
      logger.warn({ url, result }, "Telegram setWebhook did not return ok");
    }
  } catch (err) {
    logger.warn({ err }, "Telegram setWebhook failed (non-fatal)");
  }
}

/** Largest available profile-photo file_id for a Telegram user, or null. */
export async function getTelegramUserPhotoFileId(
  botToken: string,
  telegramUserId: number
): Promise<string | null> {
  try {
    const data = await tgApi<{ photos: Array<Array<{ file_id: string }>> }>(
      botToken,
      "getUserProfilePhotos",
      { user_id: telegramUserId, limit: 1 }
    );
    const sizes = data.result?.photos?.[0];
    if (!sizes || sizes.length === 0) return null;
    return sizes[sizes.length - 1].file_id; // last = largest size
  } catch (err) {
    logger.warn({ err }, "getTelegramUserPhotoFileId failed (non-fatal)");
    return null;
  }
}

/** Resolves a file_id to a downloadable file_path (short-lived per Telegram's rules). */
export async function getTelegramFilePath(botToken: string, fileId: string): Promise<string | null> {
  const data = await tgApi<{ file_path?: string }>(botToken, "getFile", { file_id: fileId });
  return data.result?.file_path ?? null;
}

// ─── Phase 7: bot identity (username + avatar) ─────────────────────────────

/**
 * Reads a bot's own public identity from Telegram: its `@username` (via
 * `getMe`) and its profile-photo `file_id` (via `getUserProfilePhotos` +
 * `getFile`, called with the bot's own numeric id — a bot is a Telegram
 * "user" like any other, so its BotFather-set profile picture is reachable
 * through the same user-profile-photo endpoints, exactly like
 * `getTelegramUserPhotoFileId` above does for a human account).
 *
 * Deliberately returns a `file_id`, never a resolved file URL: Telegram's
 * `getFile` result embeds the bot token in the download path
 * (`.../file/bot<TOKEN>/<path>`), and that must never reach the browser or
 * get persisted. Callers store the file_id and serve the bytes through the
 * server-side proxy at `GET /api/bots/:botId/avatar` (see routes/bots.ts),
 * which re-resolves file_path on every request since it's short-lived.
 *
 * Never throws — on any failure (invalid/revoked token, network error, no
 * photo set) returns nulls and logs a warning, same contract as every other
 * best-effort helper in this file.
 */
export async function fetchBotIdentity(
  botToken: string
): Promise<{ username: string | null; avatarFileId: string | null }> {
  try {
    const me = await tgApi<{ id: number; username?: string }>(botToken, "getMe");
    if (!me.ok || !me.result) {
      logger.warn({ description: me.description }, "fetchBotIdentity: getMe failed");
      return { username: null, avatarFileId: null };
    }
    const username = me.result.username ?? null;
    const avatarFileId = await getTelegramUserPhotoFileId(botToken, me.result.id);
    return { username, avatarFileId };
  } catch (err) {
    logger.warn({ err }, "fetchBotIdentity failed (non-fatal)");
    return { username: null, avatarFileId: null };
  }
}
