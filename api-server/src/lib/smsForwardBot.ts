/**
 * lib/smsForwardBot.ts — مسیرِ «بات» در «ارسال پیامک به تلگرام»: باتِ خودِ کاربر (توکنِ خودش) پیام را
 * به چتِ مقصد می‌فرستد. تلگرام به باتِ بدونِ /start پیامِ خصوصی نمی‌دهد؛ برایِ گروه/کانال باید بات عضو/ادمین باشد.
 */
import { tgApi } from "./telegram";
import type { SendResult } from "./smsForwarder";

const BOT_TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/;
export const isBotTokenShape = (t: string) => BOT_TOKEN_RE.test(t);

/** `getMe` — توکن را تأیید و یوزرنیمِ بات را برمی‌گرداند. هرگز throw نمی‌کند. */
export async function verifyBotToken(token: string): Promise<{ ok: true; username: string } | { ok: false; error: string }> {
  try {
    const r = await tgApi<{ username?: string }>(token, "getMe");
    if (r.ok && r.result?.username) return { ok: true, username: r.result.username };
    return { ok: false, error: r.description ?? "توکن نامعتبر است" };
  } catch {
    return { ok: false, error: "اتصال به تلگرام برقرار نشد" };
  }
}

/** شناسه‌ی عددی به‌صورتِ عدد، `@username` همان‌طور. */
export function chatIdFor(chatRef: string): string | number {
  if (/^-?\d{5,20}$/.test(chatRef)) {
    const n = Number(chatRef);
    if (Number.isSafeInteger(n)) return n;
  }
  return chatRef;
}

export async function sendViaBot(token: string, chatRef: string, text: string): Promise<SendResult> {
  try {
    const r = await tgApi(token, "sendMessage", { chat_id: chatIdFor(chatRef), text, disable_web_page_preview: true });
    return r.ok ? { ok: true } : { ok: false, error: r.description ?? "telegram_error" };
  } catch {
    return { ok: false, error: "telegram_unreachable" };
  }
}
