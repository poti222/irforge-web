/**
 * routes/botMedia.ts — آپلود و پروکسی مدیای بات.
 * ─────────────────────────────────────────────────────────────────────────────
 * بات پنل‌ها را با `file_id` تلگرام می‌سازد، نه با URL. کاربر برای گرفتن یک
 * `file_id` امروز مجبور است فایل را به بات بفرستد و از خروجی دیباگ کپی کند.
 * اینجا فایل از سایت آپلود می‌شود، سرور آن را **با توکن خود بات** به یک چت
 * می‌فرستد و `file_id` را برمی‌گرداند.
 *
 * چت مقصد به ترتیب: `bot_settings.media_chat_id` → آی‌دی تلگرامِ صاحب بات.
 * اگر هیچ‌کدام نبود **۴۰۹ با پیام روشن** برمی‌گردد تا UI به حالت «file_id دستی»
 * برگردد — نه ۵۰۰ و نه یک شکست بی‌صدا.
 *
 * توکن هرگز به کلاینت نمی‌رود: هم آپلود و هم پروکسیِ دانلود سمت سرور انجام
 * می‌شوند (همان الگوی `GET /api/bots/:botId/avatar`).
 */
import { Router } from "express";
import { db, botsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth.js";
import { perUserRateLimit } from "../middleware/rateLimit.js";
import { decryptToken } from "../lib/tokenCrypto.js";
import { tgApi, getTelegramFilePath } from "../lib/telegram.js";
import { logger } from "../lib/logger.js";
import { resolveBotSheet, readSettings, sendBotConfigError, BotConfigError } from "../lib/botConfig.js";

const router = Router();

/**
 * سقف حجم آپلود. تلگرام تا ۵۰MB می‌پذیرد؛ سقف واقعیِ ما بدنه‌ی JSON است —
 * `app.ts` این مسیر را روی یک تایرِ جداگانه‌ی بزرگ‌تر (`MEDIA_BODY_LIMIT`،
 * فعلاً ۴۲mb) گذاشته، نه تایرِ عمومیِ `/api/bots` (۱۰mb)، دقیقاً چون فقط این
 * اندپوینت قرار است فایل ویدیو/صوت واقعی حمل کند و بالا بردنِ تایرِ عمومی
 * سطحِ حمله‌ی بدنه‌ی بزرگ را برای همه‌ی مسیرهای دیگرِ `/api/bots/*` هم باز
 * می‌کرد. base64 حدود ۳۳٪ به حجم اضافه می‌کند؛ ۳۰MB خام ≈ ۴۰MB بدنه — زیر آن
 * سقف با حاشیه‌ی امن.
 */
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

/**
 * تصویر، ویدیو و صوت — یعنی هر چیزی که یک پنل بات واقعاً ممکن است نیاز داشته
 * باشد (عکس، گیف، ویدیوی کوتاه، پیام صوتی، آهنگ). فایل عمومی (`application/*`)
 * عمداً بیرون می‌ماند، که پنل را به یک اشتراک‌گذار فایل تبدیل می‌کرد. این تصمیم
 * محصولی است و باید **هر دو طرف** اعمال شود — کلاینت `accept` می‌گذارد، ولی
 * تنها چیزی که واقعاً جلویش را می‌گیرد همین لیست است.
 */
const ALLOWED_PREFIXES = ["image/", "video/", "audio/"];

/** نوع تلگرامیِ متناسب با mime — تعیین می‌کند کدام متد و کدام کلید پاسخ. */
function telegramTarget(mimeType: string): { method: string; field: string; resultKey: string } {
  // گیف با sendAnimation می‌رود نه sendPhoto/sendDocument: تلگرام همین‌طور
  // نگهش می‌دارد (بی‌صدا، حلقه‌ای)، در حالی که sendPhoto گیف را به یک فریمِ
  // ثابت تبدیل می‌کند و sendDocument پیش‌نمایشِ داخلِ چت را از دست می‌دهد.
  if (mimeType === "image/gif")
    return { method: "sendAnimation", field: "animation", resultKey: "animation" };
  if (mimeType.startsWith("image/")) return { method: "sendPhoto", field: "photo", resultKey: "photo" };
  if (mimeType.startsWith("video/")) return { method: "sendVideo", field: "video", resultKey: "video" };
  // صوت به‌عنوان **voice** فرستاده می‌شود نه audio: پنل‌های بات پیام صوتی
  // می‌خواهند (همان حباب موج‌دار)، نه یک ترک موزیک با کاور و عنوان. تلگرام
  // برای voice فقط OGG/Opus را قبول می‌کند، پس بقیه‌ی فرمت‌ها audio می‌مانند.
  if (mimeType === "audio/ogg" || mimeType === "audio/opus")
    return { method: "sendVoice", field: "voice", resultKey: "voice" };
  if (mimeType.startsWith("audio/")) return { method: "sendAudio", field: "audio", resultKey: "audio" };
  return { method: "sendDocument", field: "document", resultKey: "document" };
}

/**
 * هسته‌ی «آپلود به بات» — بایت‌ها را با توکنِ **همین بات** به یک چت می‌فرستد
 * و `file_id`ی نتیجه را برمی‌گرداند. قبلاً فقط داخلِ روتِ زیر بود؛
 * IRFORGE_TELEGRAM_UPLOAD_PANELTYPES_VPNDELIVERY_PROMPT بخش A هم به همین
 * منطق نیاز دارد — برایِ پلِ «فایلِ ضبط‌شده با بات پلتفرم» → «file_id قابلِ
 * فرستادن با توکنِ بات تننت» (نگاه کن `lib/uploadSessions.ts::
 * convertItemForBot`). استخراج شد تا دو مصرف‌کننده یک منطق را کپی نکنند.
 */
async function _sendToTelegram(
  token: string, chatId: string, method: string, field: string,
  buffer: Buffer, mimeType: string, filename: string,
): Promise<{ ok: boolean; error_code?: number; description?: string; result?: Record<string, any> }> {
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("disable_notification", "true");
  form.set(field, new Blob([buffer], { type: mimeType }), filename);

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    body: form,
  });
  return (await response.json()) as { ok: boolean; error_code?: number; description?: string; result?: Record<string, any> };
}

/**
 * توکنِ خراب/نامعتبر -- هیچ ربطی به خودِ فایل ندارد، برخلافِ ردِ یک فایلِ
 * واقعی (که همیشه توضیحِ مشخصِ فایل‌محور دارد، مثلاً PHOTO_INVALID_DIMENSIONS
 * یا FILE_TOO_BIG). تلگرام برای توکنِ بدشکل یا دیگر-معتبرنبوده با ۴۰۱
 * «Unauthorized» یا ۴۰۴ «Not Found» جواب می‌دهد -- زنده دیده شد (گل‌آذین:
 * sendPhoto → «Not Found»، بارها، حتی بعدِ fallbackِ sendDocument پایین،
 * چون مشکل از فرمتِ فایل نبود). سندِ retry-as-sendDocument برای این حالت
 * فقط یک تماسِ بی‌فایده‌ی اضافه به تلگرام است، پس زودتر رد می‌شود.
 */
function _isInvalidTokenError(payload: { error_code?: number; description?: string }): boolean {
  const desc = (payload.description || "").toLowerCase();
  return payload.error_code === 401 || payload.error_code === 404 || desc === "not found" || desc === "unauthorized";
}

export async function uploadBufferToBotChat(
  token: string,
  chatId: string,
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<{ fileId: string; type: string; duration: number | null }> {
  const { method, field, resultKey } = telegramTarget(mimeType);

  let payload = await _sendToTelegram(token, chatId, method, field, buffer, mimeType, filename);
  let usedResultKey = resultKey;

  // زنده دیده شد (گل‌آذین): توکنِ ذخیره‌شده دیگر معتبر نیست و تلگرام هر
  // متدی را با ۴۰۱/۴۰۴ رد می‌کند -- retry-as-sendDocument پایین این را
  // درست نمی‌کند (مشکل از فرمتِ فایل نیست) و فقط پیامِ گمراه‌کننده‌ای
  // می‌سازد که انگار خودِ فایل رد شده. زودتر با پیامِ درست متوقف می‌شود.
  //
  // Live incident 2026-09-21 -- this fired again right after a fresh token
  // PATCH (200 on the update). _throwInvalidToken never logs the token
  // itself, but its LENGTH and whether it matches Telegram's own
  // <digits>:<secret> shape distinguish "wrong/truncated paste" from
  // "a well-formed token Telegram still rejects" (revoked/wrong bot),
  // without ever needing to see the value.
  const _throwInvalidToken = (currentMethod: string): never => {
    logger.warn(
      {
        method: currentMethod,
        error_code: payload.error_code,
        description: payload.description,
        tokenLength: token.length,
        tokenShapeOk: /^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token),
      },
      "uploadBufferToBotChat: token rejected by Telegram"
    );
    throw new BotConfigError(
      409,
      "توکنِ این بات دیگر برایِ تلگرام معتبر نیست. از تنظیماتِ بات، توکن را دوباره از BotFather بگیرید و ذخیره کنید.",
      "invalid_token"
    );
  };

  if (!payload.ok && _isInvalidTokenError(payload)) _throwInvalidToken(method);

  // تلگرام sendPhoto/sendVideo/sendAnimation را برای فایل‌هایی با ابعاد یا
  // حجمِ خارج از محدودیتِ خودش رد می‌کند (مثلاً یک پوسترِ تبلیغاتیِ
  // خیلی‌بزرگ یا کشیده) — sendDocument همان محدودیت‌ها را ندارد، پس اگر
  // ارسالِ «طبیعی» رد شد، دوباره به‌عنوانِ فایلِ ساده امتحان می‌کنیم تا
  // آپلود فقط به‌خاطرِ «فرمتِ اشتباه» کلاً شکست نخورد.
  if (!payload.ok && method !== "sendDocument") {
    logger.warn(
      { method, description: payload.description },
      "uploadBufferToBotChat: native send rejected, retrying as sendDocument"
    );
    payload = await _sendToTelegram(token, chatId, "sendDocument", "document", buffer, mimeType, filename);
    usedResultKey = "document";
  }

  if (!payload.ok && _isInvalidTokenError(payload)) _throwInvalidToken("sendDocument");

  if (!payload.ok) {
    throw new BotConfigError(409, `تلگرام فایل را نپذیرفت: ${payload.description ?? "خطای نامشخص"}`, "telegram_rejected");
  }

  const result = payload.result ?? {};
  const raw = result[usedResultKey];
  const fileId = Array.isArray(raw) ? raw[raw.length - 1]?.file_id : raw?.file_id;
  if (!fileId) throw new BotConfigError(502, "تلگرام فایل را ذخیره کرد ولی شناسه‌ای برنگرداند.");
  const duration = Array.isArray(raw) ? null : typeof raw?.duration === "number" ? raw.duration : null;

  return { fileId, type: usedResultKey, duration };
}

export async function botToken(botId: string): Promise<string> {
  const [bot] = await db.select({ token: botsTable.token }).from(botsTable).where(eq(botsTable.id, botId)).limit(1);
  try {
    const token = decryptToken(bot?.token ?? "");
    if (token) return token;
  } catch {
    /* افتاد پایین */
  }
  throw new BotConfigError(
    409,
    "توکن این بات روی سرور در دسترس نیست، پس آپلود مدیا ممکن نیست. فعلاً file_id را دستی وارد کنید.",
    "no_token"
  );
}

/** چت مقصدِ آپلود، یا ۴۰۹ با راهنمای دقیق. */
export async function uploadChatId(spreadsheetId: string, userId: string): Promise<string> {
  const settings = await readSettings(spreadsheetId);
  const configured = (settings as Record<string, unknown>).media_chat_id;
  if (typeof configured === "string" && configured.trim()) return configured.trim();
  if (typeof configured === "number") return String(configured);

  const [user] = await db
    .select({ telegramId: usersTable.telegramId })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (user?.telegramId) return user.telegramId;

  throw new BotConfigError(
    409,
    "چت مقصدی برای آپلود مدیا تعیین نشده است. یا حساب تلگرام‌تان را به سایت وصل کنید و یک‌بار به بات پیام بدهید، یا کلید media_chat_id را در تنظیمات بات ست کنید. تا آن موقع می‌توانید file_id را دستی وارد کنید.",
    "no_media_chat"
  );
}

// ─── POST /api/bots/:botId/media ────────────────────────────────────────────

router.post("/bots/:botId/media", requireAuth, perUserRateLimit("media_upload", 60, 60 * 60 * 1000), async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);

    // data-URL، همان الگوی `POST /bots/:botId/telegram-profile/photo` در این ریپو.
    const dataUrl = String(req.body?.dataUrl ?? "");
    const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
    if (!match) throw new BotConfigError(400, "فایل ارسال‌شده معتبر نیست (باید data-URL باشد).");

    const [, mimeType, base64] = match;
    if (!ALLOWED_PREFIXES.some((p) => mimeType.startsWith(p)))
      throw new BotConfigError(
        400,
        `نوع فایل «${mimeType}» پشتیبانی نمی‌شود. مدیای پنل فقط می‌تواند تصویر، ویدیو یا فایل صوتی باشد.`,
        "unsupported_type"
      );

    const buffer = Buffer.from(base64, "base64");
    if (buffer.length === 0) throw new BotConfigError(400, "فایل خالی است.");
    if (buffer.length > MAX_UPLOAD_BYTES)
      throw new BotConfigError(
        400,
        `حجم فایل بیشتر از ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} مگابایت است.`
      );

    const chatId = await uploadChatId(spreadsheetId, req.userId);
    const token = await botToken(req.params.botId);
    const filename = String(req.body?.filename ?? "upload").slice(0, 120);

    const { fileId, type, duration } = await uploadBufferToBotChat(token, chatId, buffer, mimeType, filename);
    res.status(201).json({ fileId, type, duration, mimeType });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to upload media");
  }
});

// ─── GET /api/bots/:botId/media/:fileId ─────────────────────────────────────

/**
 * پروکسی دانلود: `getFile` را با توکن بات می‌زند و محتوا را استریم می‌کند.
 * URL واقعی تلگرام توکن بات را داخل خودش دارد (`/file/bot<TOKEN>/…`) پس هرگز
 * به کلاینت نمی‌رود.
 */
router.get("/bots/:botId/media/:fileId", requireAuth, async (req: any, res) => {
  try {
    await resolveBotSheet(req.userId, req.params.botId);
    const token = await botToken(req.params.botId);

    const filePath = await getTelegramFilePath(token, req.params.fileId);
    if (!filePath) throw new BotConfigError(404, "این فایل روی تلگرام پیدا نشد.", "file_not_found");

    const upstream = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
    if (!upstream.ok || !upstream.body)
      throw new BotConfigError(502, "دریافت فایل از تلگرام ناموفق بود.");

    const contentType = upstream.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);
    // کش کوتاه و خصوصی: file_path تلگرام عمر کوتاهی دارد و محتوا هم عمومی نیست.
    res.setHeader("Cache-Control", "private, max-age=300");

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.end(buffer);
  } catch (err) {
    sendBotConfigError(res, err, "Failed to proxy media");
  }
});

/** آیا آپلود روی این بات کار می‌کند؟ UI با این تصمیم می‌گیرد فرم آپلود بدهد یا نه. */
router.get("/bots/:botId/media-status", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    try {
      await uploadChatId(spreadsheetId, req.userId);
      await botToken(req.params.botId);
      res.json({ available: true, maxBytes: MAX_UPLOAD_BYTES });
    } catch (err: any) {
      res.json({
        available: false,
        maxBytes: MAX_UPLOAD_BYTES,
        reason: err instanceof BotConfigError ? err.message : "آپلود مدیا روی این بات در دسترس نیست.",
        code: err instanceof BotConfigError ? err.code : null,
      });
    }
  } catch (err) {
    logger.debug({ err }, "media-status failed");
    sendBotConfigError(res, err, "Failed to read media status");
  }
});

export const __testables = { telegramTarget, ALLOWED_PREFIXES, MAX_UPLOAD_BYTES };

export default router;
