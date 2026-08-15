/**
 * lib/telegramResolve.ts — تبدیل «@یوزرنیم» به آی‌دی عددی تلگرام.
 * ─────────────────────────────────────────────────────────────────────────────
 * هرجای سایت که از ادمین یک شناسه‌ی تلگرامی می‌گیرد باید از این ماژول رد شود:
 * افزودن ادمین بات، کانال‌های عضویت اجباری، و هر چیز مشابهی که بعداً اضافه
 * شود. قبلاً این منطق فقط داخل `routes/botAdmins.ts` بود و هر مصرف‌کننده‌ی
 * جدید یا کپی‌اش می‌کرد یا — بدتر — یوزرنیم را خام ذخیره می‌کرد.
 *
 * **چرا خام ذخیره‌کردن غلط است:** بات موقع چک‌کردن دسترسی یا عضویت، با آی‌دی
 * عددی کار می‌کند. یوزرنیم هم قابل تغییر است؛ کاربری که یوزرنیمش را عوض کند
 * دسترسی‌اش را از دست می‌دهد (یا بدتر، کسی که آن یوزرنیم را برمی‌دارد
 * دسترسی می‌گیرد).
 *
 * **محدودیت واقعی تلگرام (نه باگ ما):** `getChat` با یوزرنیم فقط برای
 * کاربرانی جواب می‌دهد که قبلاً با **همین بات** چت را شروع کرده‌اند، یا برای
 * کانال/گروه عمومی. اگر جواب نداد، پیام برگشتی باید بگوید کاربر چه کاری
 * می‌تواند بکند — نه یک «ورودی نامعتبر» که کاربر را دنبال نخود سیاه می‌فرستد.
 */
import { db, botsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptToken } from "./tokenCrypto.js";
import { tgApi } from "./telegram.js";
import { BotConfigError } from "./botConfig.js";

/** یوزرنیم تلگرام: حرف اول انگلیسی، ۵ تا ۳۲ کاراکتر. */
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

/** توکن بات، یا رشته‌ی خالی اگر در دسترس نبود (هرگز throw نمی‌کند). */
async function botTokenOrEmpty(botId: string): Promise<string> {
  const [bot] = await db.select({ token: botsTable.token }).from(botsTable).where(eq(botsTable.id, botId)).limit(1);
  try {
    return decryptToken(bot?.token ?? "") || "";
  } catch {
    return "";
  }
}

export type ResolvedUser = { userId: string; username: string };

/**
 * یوزرنیم یا آی‌دی عددیِ یک **کاربر** → آی‌دی عددی.
 *
 * آی‌دی عددی بدون هیچ فراخوانی شبکه‌ای قبول می‌شود: کاربری که آی‌دی‌اش را
 * می‌داند نباید مجبور باشد بات را استارت کند.
 */
export async function resolveTelegramUser(botId: string, input: string): Promise<ResolvedUser> {
  const raw = String(input ?? "").trim();
  if (/^\d{4,}$/.test(raw)) return { userId: raw, username: "" };

  const handle = raw.replace(/^@/, "");
  if (!USERNAME_RE.test(handle))
    throw new BotConfigError(
      400,
      "یوزرنیم یا آی‌دی عددی معتبر نیست. یوزرنیم باید ۵ تا ۳۲ کاراکتر انگلیسی باشد.",
      "bad_identifier",
    );

  const guidance =
    "نشد آی‌دی عددی این یوزرنیم را از تلگرام بگیریم. یا کاربر باید یک‌بار بات را استارت کند، یا آی‌دی عددی‌اش را مستقیم وارد کنید.";

  const token = await botTokenOrEmpty(botId);
  if (!token) throw new BotConfigError(409, guidance, "username_unresolvable");

  const chat = await tgApi<{ id: number; username?: string }>(token, "getChat", { chat_id: `@${handle}` });
  if (!chat.ok || !chat.result?.id) throw new BotConfigError(409, guidance, "username_unresolvable");

  return { userId: String(chat.result.id), username: chat.result.username ?? handle };
}

export type ResolvedChat = {
  /** آی‌دی عددی — برای سوپرگروه/کانال منفی و معمولاً با `-100` شروع می‌شود. */
  chatId: string;
  title: string;
  username: string;
  type: string;
  /** آیا خودِ بات در این چت ادمین است؟ بدون این، چک عضویت اجباری کار نمی‌کند. */
  botIsAdmin: boolean;
};

/**
 * یوزرنیم/آی‌دی یک **کانال یا گروه** → آی‌دی عددی + وضعیت ادمین‌بودن بات.
 *
 * برخلاف نسخه‌ی کاربر، اینجا آی‌دی عددی هم به تلگرام فرستاده می‌شود: برای
 * عضویت اجباری باید بدانیم بات واقعاً داخل آن کانال هست و ادمین است، وگرنه
 * `getChatMember` بعداً سر هر کاربر شکست می‌خورد و بات کاربر را پشت درِ
 * قفلی نگه می‌دارد که هیچ‌وقت باز نمی‌شود.
 */
export async function resolveTelegramChat(botId: string, input: string): Promise<ResolvedChat> {
  const raw = String(input ?? "").trim();
  const isNumeric = /^-?\d{4,}$/.test(raw);
  const handle = raw.replace(/^@/, "").replace(/^https:\/\/t\.me\//i, "");

  if (!isNumeric && !USERNAME_RE.test(handle))
    throw new BotConfigError(
      400,
      "شناسه‌ی کانال معتبر نیست. یا @یوزرنیم کانال را وارد کنید یا آی‌دی عددی‌اش را (که معمولاً با -100 شروع می‌شود).",
      "bad_identifier",
    );

  const token = await botTokenOrEmpty(botId);
  if (!token)
    throw new BotConfigError(
      409,
      "توکن این بات روی سرور در دسترس نیست، پس نمی‌توانیم کانال را بررسی کنیم.",
      "no_token",
    );

  const chatId = isNumeric ? raw : `@${handle}`;
  const chat = await tgApi<{ id: number; title?: string; username?: string; type?: string }>(
    token,
    "getChat",
    { chat_id: chatId },
  );
  if (!chat.ok || !chat.result?.id)
    throw new BotConfigError(
      409,
      `تلگرام این کانال را به بات نشان نداد${chat.description ? ` (${chat.description})` : ""}. مطمئن شوید کانال عمومی است یا بات را داخلش اضافه کرده‌اید.`,
      "chat_unresolvable",
    );

  // ادمین‌بودن بات چک می‌شود ولی **اجباری نیست**: کاربر ممکن است بخواهد اول
  // کانال را ثبت کند و بعد بات را ادمین کند. فقط باید بداند.
  let botIsAdmin = false;
  try {
    const me = await tgApi<{ id: number }>(token, "getMe");
    if (me.ok && me.result?.id) {
      const member = await tgApi<{ status?: string }>(token, "getChatMember", {
        chat_id: chat.result.id,
        user_id: me.result.id,
      });
      botIsAdmin = member.ok && (member.result?.status === "administrator" || member.result?.status === "creator");
    }
  } catch {
    botIsAdmin = false;
  }

  return {
    chatId: String(chat.result.id),
    title: chat.result.title ?? handle,
    username: chat.result.username ?? (isNumeric ? "" : handle),
    type: chat.result.type ?? "",
    botIsAdmin,
  };
}
