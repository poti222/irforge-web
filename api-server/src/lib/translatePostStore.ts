/**
 * lib/translatePostStore.ts — website-side data layer + publish action for
 * the `translate_post` bot plugin (Google Translate API, 11-language channel
 * posts, plugins/translate_post/ in the bot repo).
 * ─────────────────────────────────────────────────────────────────────────────
 * Mirrors `plugins/translate_post/domain.py` field-for-field and writes to
 * the SAME two sheet tabs (`translate_post_config`, `translate_post_posts`)
 * with the SAME row shape and the SAME id format (`newRecordId("tp")` here
 * == `new_id("tp")` there) — a post published from the website must be
 * readable by the bot's own `/start tl_<post_id>_<lang>` deep-link delivery
 * handler (`handlers/user.py::cmd_start` in the bot repo) exactly like one
 * composed from inside Telegram.
 *
 * Unlike the giveaway/booking/etc. stores, this one does real outbound I/O
 * (Google Translate, then Telegram) — not just sheet CRUD — because
 * "publish a post" genuinely has side effects outside the sheet. The admin
 * flow inside the bot (`plugins/translate_post/handlers.py`) does the exact
 * same two calls for the exact same reason; this is the website-side
 * equivalent so an operator who prefers a web form over typing into
 * Telegram gets full parity, not a second-class subset.
 */
import { eq } from "drizzle-orm";
import { db, botsTable } from "@workspace/db";
import {
  getEntity, putEntity, listEntity, assertSheetsAuthoritative, BotConfigError,
} from "./botConfig.js";
import { newRecordId } from "./pluginCollections.js";
import { nowIso, TELEGRAM_TEXT_LIMIT } from "./botTypes.js";
import { tgApi } from "./telegram.js";
import { decryptToken } from "./tokenCrypto.js";

const CONFIG_TAB = "translate_post_config";
const POSTS_TAB = "translate_post_posts";
const CONFIG_ID = "config";
const DEFAULT_SOURCE_LANG = "fa";

/**
 * همان ۱۱ زبان و همان ترتیب `plugins/translate_post/domain.py::LANGUAGES` —
 * تغییرِ این آرایه بدون تغییرِ همتای پایتونی یعنی دو طرف دیگر هم‌ترتیب
 * نیستند (بی‌ضرر برای تحویل، چون تحویل با کد زبان کار می‌کند نه ترتیب، ولی
 * کیبوردِ منتشرشده‌ی هر طرف با ترتیب متفاوت گیج‌کننده می‌شد).
 */
export const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: "fa", label: "🇮🇷 فارسی" },
  { code: "en", label: "🇬🇧 English" },
  { code: "ar", label: "🇸🇦 العربية" },
  { code: "zh", label: "🇨🇳 中文" },
  { code: "ja", label: "🇯🇵 日本語" },
  { code: "ko", label: "🇰🇷 한국어" },
  { code: "fr", label: "🇫🇷 Français" },
  { code: "de", label: "🇩🇪 Deutsch" },
  { code: "es", label: "🇪🇸 Español" },
  { code: "ru", label: "🇷🇺 Русский" },
  { code: "tr", label: "🇹🇷 Türkçe" },
];
const LANGUAGE_LABELS = new Map(LANGUAGES.map((l) => [l.code, l.label]));

export interface TranslatePostConfig {
  channelId: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  sourceLang: string;
  enabled: boolean;
  configured: boolean;
}

interface RawConfig {
  channel_id?: string;
  api_key?: string;
  source_lang?: string;
  enabled?: boolean;
}

export interface TranslatePostPost {
  id: string;
  sourceText: string;
  sourceLang: string;
  languages: string[];
  channelMessageId: number | null;
  createdAt: string | null;
}

interface RawPost {
  id?: string;
  source_text?: string;
  source_lang?: string;
  translations?: Record<string, string>;
  channel_message_id?: number | null;
  created_at?: string;
}

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

function maskKey(apiKey: string): string {
  if (!apiKey) return "";
  if (apiKey.length <= 8) return "•".repeat(apiKey.length);
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
}

// ─── تنظیمات (singleton) ────────────────────────────────────────────────────

async function readRawConfig(spreadsheetId: string): Promise<RawConfig> {
  return (await getEntity<RawConfig>(spreadsheetId, CONFIG_TAB, CONFIG_ID)) ?? {};
}

export async function getConfig(spreadsheetId: string): Promise<TranslatePostConfig> {
  const raw = await readRawConfig(spreadsheetId);
  const channelId = raw.channel_id ?? "";
  const apiKey = raw.api_key ?? "";
  return {
    channelId,
    hasApiKey: Boolean(apiKey),
    apiKeyMasked: maskKey(apiKey),
    sourceLang: raw.source_lang || DEFAULT_SOURCE_LANG,
    enabled: Boolean(raw.enabled),
    configured: Boolean(channelId) && Boolean(apiKey),
  };
}

export async function updateConfig(
  spreadsheetId: string,
  patch: { channelId?: string; apiKey?: string; enabled?: boolean },
): Promise<TranslatePostConfig> {
  await assertSheetsAuthoritative(CONFIG_TAB);
  const current = await readRawConfig(spreadsheetId);

  const channelId = patch.channelId !== undefined ? patch.channelId.trim() : current.channel_id ?? "";
  const apiKey = patch.apiKey !== undefined ? patch.apiKey.trim() : current.api_key ?? "";
  if (patch.channelId !== undefined && !channelId) throw bad("آیدیِ کانال نمی‌تواند خالی باشد.");
  if (patch.apiKey !== undefined && !apiKey) throw bad("کلیدِ API نمی‌تواند خالی باشد.");

  const next: RawConfig = {
    channel_id: channelId,
    api_key: apiKey,
    source_lang: current.source_lang || DEFAULT_SOURCE_LANG,
    enabled: patch.enabled !== undefined ? patch.enabled : Boolean(current.enabled),
  };
  await putEntity(spreadsheetId, CONFIG_TAB, CONFIG_ID, next);
  return getConfig(spreadsheetId);
}

// ─── پست‌ها ──────────────────────────────────────────────────────────────────

export async function listPosts(spreadsheetId: string, limit = 20): Promise<TranslatePostPost[]> {
  const rows = await listEntity<RawPost>(spreadsheetId, POSTS_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => {
      const v = r.value as RawPost;
      return {
        id: v.id || r.key,
        sourceText: v.source_text ?? "",
        sourceLang: v.source_lang ?? DEFAULT_SOURCE_LANG,
        languages: Object.keys(v.translations ?? {}),
        channelMessageId: v.channel_message_id ?? null,
        createdAt: v.created_at ?? null,
      };
    })
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, limit);
}

// ─── فراخوانیِ واقعیِ شبکه ────────────────────────────────────────────────────
// دو تک‌نقطه‌ای که واقعاً به شبکه می‌زنند — همان قراردادِ `_call_provider`ی
// پایتون: تست‌ها این شیء را `Object.assign` می‌کنند تا هرگز واقعاً اینترنت
// را لمس نکنند.

export const translatePostLayer = {
  async translate(apiKey: string, text: string, target: string, source: string): Promise<string> {
    const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`;
    let data: any;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: text, target, source, format: "text" }),
      });
      data = await res.json();
      if (!res.ok) {
        throw bad(data?.error?.message || `Google Translate error (${res.status})`, "translate_failed");
      }
    } catch (err) {
      if (err instanceof BotConfigError) throw err;
      throw bad("اتصال به سرویسِ Google Translate برقرار نشد.", "translate_failed");
    }
    const translated = data?.data?.translations?.[0]?.translatedText;
    if (typeof translated !== "string") throw bad("پاسخِ Google Translate نامعتبر بود.", "translate_failed");
    return translated;
  },
  tgApi,
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function resolveBotIdentity(botId: string): Promise<{ token: string; username: string }> {
  const [bot] = await db
    .select({ token: botsTable.token, username: botsTable.username })
    .from(botsTable)
    .where(eq(botsTable.id, botId))
    .limit(1);
  let token = "";
  try {
    token = decryptToken(bot?.token ?? "");
  } catch {
    /* falls through to the throw below */
  }
  if (!token) throw new BotConfigError(409, "توکن این بات روی سرور در دسترس نیست.", "no_token");

  let username = bot?.username ?? "";
  if (!username) {
    const me = await translatePostLayer.tgApi<{ username?: string }>(token, "getMe", {});
    username = me.result?.username ?? "";
  }
  if (!username) throw new BotConfigError(409, "یوزرنیمِ این بات از تلگرام قابل خواندن نیست.", "no_username");

  return { token, username };
}

export interface PublishResult {
  id: string;
  languages: string[];
  failedLanguages: string[];
  channelMessageId: number;
}

/**
 * ترجمه به تمامِ زبان‌ها (به‌جز زبانِ مبدأ که همان متنِ اصلی می‌ماند) و
 * انتشار روی کانالِ پیکربندی‌شده، با کیبوردِ دیپ‌لینکِ زبان‌ها. رکوردِ پست با
 * همان شکلِ `plugins/_common/store.py::RecordStore` نوشته می‌شود تا
 * `handlers/user.py`ی بات، بدونِ دانستنِ اینکه پست از سایت آمده یا از
 * تلگرام، همان‌طور تحویلش بدهد.
 */
export async function publishPost(
  botId: string,
  spreadsheetId: string,
  sourceText: string,
): Promise<PublishResult> {
  const text = sourceText.trim();
  if (!text) throw bad("متنِ پست نمی‌تواند خالی باشد.");
  if (text.length > TELEGRAM_TEXT_LIMIT)
    throw bad(`طول پست از ${TELEGRAM_TEXT_LIMIT} کاراکتر بیشتر است (سقف تلگرام).`);

  const config = await getConfig(spreadsheetId);
  if (!config.configured)
    throw new BotConfigError(409, "اول کلیدِ API و کانالِ مقصد را تنظیم کنید.", "not_configured");

  const raw = await readRawConfig(spreadsheetId);
  const apiKey = raw.api_key ?? "";
  const sourceLang = config.sourceLang;

  const translations: Record<string, string> = { [sourceLang]: text };
  const failedLanguages: string[] = [];
  for (const { code } of LANGUAGES) {
    if (code === sourceLang) continue;
    try {
      translations[code] = await translatePostLayer.translate(apiKey, text, code, sourceLang);
    } catch {
      failedLanguages.push(code);
    }
  }
  if (Object.keys(translations).length <= 1)
    throw new BotConfigError(502, "ترجمه به هیچ زبانی موفق نشد. کلیدِ API را بررسی کنید.", "translate_all_failed");

  const { token, username } = await resolveBotIdentity(botId);
  const postId = newRecordId("tp");
  const buttons = LANGUAGES.filter((l) => l.code in translations).map((l) => ({
    text: l.label,
    url: `https://t.me/${username}?start=tl_${postId}_${l.code}`,
  }));

  const sent = await translatePostLayer.tgApi<{ message_id: number }>(token, "sendMessage", {
    chat_id: config.channelId,
    text,
    reply_markup: { inline_keyboard: chunk(buttons, 2) },
  });
  if (!sent.ok || !sent.result?.message_id)
    throw new BotConfigError(
      409,
      `تلگرام پست را نپذیرفت: ${sent.description ?? "خطای نامشخص"} — بات باید ادمینِ کانال با اجازه‌ی ارسالِ پیام باشد.`,
      "telegram_rejected",
    );

  await assertSheetsAuthoritative(POSTS_TAB);
  const record: RawPost = {
    id: postId,
    source_text: text,
    source_lang: sourceLang,
    translations,
    channel_message_id: sent.result.message_id,
    created_at: nowIso(),
  };
  await putEntity(spreadsheetId, POSTS_TAB, postId, record);

  return {
    id: postId,
    languages: Object.keys(translations),
    failedLanguages,
    channelMessageId: sent.result.message_id,
  };
}

export function languageLabel(code: string): string {
  return LANGUAGE_LABELS.get(code) ?? code;
}
