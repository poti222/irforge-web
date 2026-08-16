/**
 * lib/translate.ts — ترجمه‌ی ماشینی برای رشته‌های بات.
 * ─────────────────────────────────────────────────────────────────────────────
 * یک بات چندزبانه یعنی هر رشته باید در ۵ زبان نوشته شود؛ دستی این کار برای
 * چند ده کلید، ساعت‌ها وقت می‌برد و در عمل هیچ‌وقت انجام نمی‌شود — نتیجه‌اش
 * باتی است که برای کاربر انگلیسی‌زبان نصفه‌فارسی حرف می‌زند.
 *
 * **چرا سرویس هاردکد نشده:** این پروژه هیچ کردنشیال ترجمه‌ای ندارد، و
 * چسباندنش به یک سرویس عمومی بدون کلید یعنی یک وابستگی شکننده که یک روز
 * بی‌خبر از کار می‌افتد. پس ارائه‌دهنده با env انتخاب می‌شود و سه شکل رایج
 * پشتیبانی می‌شود. بدون تنظیم، endpoint یک **۵۰۳ با پیام روشن** می‌دهد — نه
 * خطای مبهم و نه ترجمه‌ی ساختگی.
 *
 * متغیرها:
 *   TRANSLATE_PROVIDER = libretranslate | deepl | google   (خالی = خاموش)
 *   TRANSLATE_API_KEY  = کلید سرویس (برای libretranslate اختیاری)
 *   TRANSLATE_API_URL  = فقط برای libretranslate؛ آدرس نمونه‌ی خودتان
 */
import { logger } from "./logger";

export type TranslateProvider = "libretranslate" | "deepl" | "google";

export class TranslateError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "TranslateError";
  }
}

export function translateProvider(): TranslateProvider | null {
  const raw = process.env.TRANSLATE_PROVIDER?.trim().toLowerCase();
  if (raw === "libretranslate" || raw === "deepl" || raw === "google") return raw;
  return null;
}

export function translateAvailable(): boolean {
  return translateProvider() !== null;
}

function notConfigured(): TranslateError {
  return new TranslateError(
    503,
    "سرویس ترجمه روی این سرور تنظیم نشده است (TRANSLATE_PROVIDER). ترجمه‌ی خودکار در دسترس نیست؛ می‌توانید متن را دستی وارد کنید.",
    "translate_not_configured",
  );
}

/**
 * کد زبان به شکلی که هر ارائه‌دهنده می‌خواهد.
 *
 * DeepL کد زبان را **بزرگ** می‌خواهد و فارسی را اصلاً پشتیبانی نمی‌کند —
 * که باید صریح گفته شود، نه اینکه یک خطای ۴۰۰ مبهم از سرویس برگردد.
 */
function providerLang(provider: TranslateProvider, lang: string): string {
  const code = lang.toLowerCase();
  if (provider === "deepl") {
    if (code === "fa") {
      throw new TranslateError(
        400,
        "DeepL از زبان فارسی پشتیبانی نمی‌کند. برای فارسی، ارائه‌دهنده‌ی دیگری تنظیم کنید.",
        "language_unsupported",
      );
    }
    return code.toUpperCase();
  }
  return code;
}

async function callLibreTranslate(text: string, source: string, target: string): Promise<string> {
  const url = process.env.TRANSLATE_API_URL?.trim();
  if (!url)
    throw new TranslateError(
      503,
      "برای libretranslate باید TRANSLATE_API_URL تنظیم شود.",
      "translate_not_configured",
    );
  const key = process.env.TRANSLATE_API_KEY?.trim();

  const res = await fetch(`${url.replace(/\/+$/, "")}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: text, source, target, format: "text", ...(key ? { api_key: key } : {}) }),
  });
  if (!res.ok) throw new TranslateError(502, `سرویس ترجمه پاسخ ${res.status} داد.`, "translate_failed");

  const payload = (await res.json()) as { translatedText?: string };
  if (typeof payload.translatedText !== "string")
    throw new TranslateError(502, "پاسخ سرویس ترجمه قابل خواندن نبود.", "translate_failed");
  return payload.translatedText;
}

async function callDeepL(text: string, source: string, target: string): Promise<string> {
  const key = process.env.TRANSLATE_API_KEY?.trim();
  if (!key) throw new TranslateError(503, "برای DeepL باید TRANSLATE_API_KEY تنظیم شود.", "translate_not_configured");

  // کلیدهای رایگان DeepL به `-free` ختم می‌شوند و دامنه‌ی جداگانه‌ای دارند.
  const host = key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
  const res = await fetch(`${host}/v2/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `DeepL-Auth-Key ${key}` },
    body: JSON.stringify({ text: [text], source_lang: source, target_lang: target }),
  });
  if (!res.ok) throw new TranslateError(502, `سرویس ترجمه پاسخ ${res.status} داد.`, "translate_failed");

  const payload = (await res.json()) as { translations?: Array<{ text?: string }> };
  const out = payload.translations?.[0]?.text;
  if (typeof out !== "string")
    throw new TranslateError(502, "پاسخ سرویس ترجمه قابل خواندن نبود.", "translate_failed");
  return out;
}

async function callGoogle(text: string, source: string, target: string): Promise<string> {
  const key = process.env.TRANSLATE_API_KEY?.trim();
  if (!key)
    throw new TranslateError(503, "برای Google Translate باید TRANSLATE_API_KEY تنظیم شود.", "translate_not_configured");

  const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: text, source, target, format: "text" }),
  });
  if (!res.ok) throw new TranslateError(502, `سرویس ترجمه پاسخ ${res.status} داد.`, "translate_failed");

  const payload = (await res.json()) as { data?: { translations?: Array<{ translatedText?: string }> } };
  const out = payload.data?.translations?.[0]?.translatedText;
  if (typeof out !== "string")
    throw new TranslateError(502, "پاسخ سرویس ترجمه قابل خواندن نبود.", "translate_failed");
  return out;
}

/** حداکثر طول متن — یک رشته‌ی بات، نه یک مقاله. */
const MAX_TEXT = 2000;

/**
 * یک متن را به چند زبان ترجمه می‌کند.
 *
 * **شکست هر زبان جدا گزارش می‌شود، نه اینکه کل درخواست بیفتد**: اگر DeepL
 * فارسی را رد کند، بقیه‌ی زبان‌ها نباید قربانی شوند. کاربر نتیجه‌ی جزئی را
 * می‌گیرد و می‌بیند کدام‌یک نشد و چرا.
 */
export async function translateTo(
  text: string,
  sourceLang: string,
  targetLangs: string[],
): Promise<Array<{ lang: string; text: string | null; error: string | null }>> {
  const provider = translateProvider();
  if (!provider) throw notConfigured();

  const trimmed = text.trim();
  if (!trimmed) throw new TranslateError(400, "متنی برای ترجمه داده نشده است.");
  if (trimmed.length > MAX_TEXT)
    throw new TranslateError(400, `متن طولانی‌تر از ${MAX_TEXT} کاراکتر است.`, "text_too_long");

  const call =
    provider === "libretranslate" ? callLibreTranslate : provider === "deepl" ? callDeepL : callGoogle;

  const out: Array<{ lang: string; text: string | null; error: string | null }> = [];
  for (const target of targetLangs) {
    if (target.toLowerCase() === sourceLang.toLowerCase()) continue;
    try {
      const translated = await call(
        trimmed,
        providerLang(provider, sourceLang),
        providerLang(provider, target),
      );
      out.push({ lang: target, text: translated, error: null });
    } catch (err) {
      logger.warn({ err, target, provider }, "translation failed for one language");
      out.push({
        lang: target,
        text: null,
        error: err instanceof TranslateError ? err.message : "ترجمه‌ی این زبان ناموفق بود.",
      });
    }
  }
  return out;
}
