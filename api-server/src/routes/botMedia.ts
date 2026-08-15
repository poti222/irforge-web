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
import { decryptToken } from "../lib/tokenCrypto.js";
import { tgApi, getTelegramFilePath } from "../lib/telegram.js";
import { logger } from "../lib/logger.js";
import { resolveBotSheet, readSettings, sendBotConfigError, BotConfigError } from "../lib/botConfig.js";

const router = Router();

/**
 * سقف حجم آپلود. تلگرام تا ۵۰MB می‌پذیرد، ولی سقف واقعیِ ما بدنه‌ی JSON است:
 * `app.ts` روی `express.json({ limit: "10mb" })` تنظیم شده و base64 حدود ۳۳٪
 * به حجم اضافه می‌کند. ۷MB خام ≈ ۹.۴MB بدنه — با حاشیه‌ی امن زیر آن سقف.
 * بالا بردن سقف سراسری برای یک اندپوینت، همه‌ی اندپوینت‌های دیگر را هم در
 * معرض بدنه‌های بزرگ می‌گذارد، پس عمداً این‌طور نشده.
 */
const MAX_UPLOAD_BYTES = 7 * 1024 * 1024;

/**
 * فقط **تصویر و صوت**.
 *
 * ویدیو عمداً بیرون است: یک پنل ویدیویی روی موبایلِ کاربر نهایی چند ده مگابایت
 * دانلود می‌کند و تجربه‌ی «منوی بات» را خراب می‌کند؛ همین‌طور فایل عمومی
 * (`application/*`)، که پنل را به یک اشتراک‌گذار فایل تبدیل می‌کرد. این تصمیم
 * محصولی است و باید **هر دو طرف** اعمال شود — کلاینت `accept` می‌گذارد، ولی
 * تنها چیزی که واقعاً جلویش را می‌گیرد همین لیست است.
 */
const ALLOWED_PREFIXES = ["image/", "audio/"];

/** نوع تلگرامیِ متناسب با mime — تعیین می‌کند کدام متد و کدام کلید پاسخ. */
function telegramTarget(mimeType: string): { method: string; field: string; resultKey: string } {
  if (mimeType.startsWith("image/") && mimeType !== "image/gif")
    return { method: "sendPhoto", field: "photo", resultKey: "photo" };
  // صوت به‌عنوان **voice** فرستاده می‌شود نه audio: پنل‌های بات پیام صوتی
  // می‌خواهند (همان حباب موج‌دار)، نه یک ترک موزیک با کاور و عنوان. تلگرام
  // برای voice فقط OGG/Opus را قبول می‌کند، پس بقیه‌ی فرمت‌ها audio می‌مانند.
  if (mimeType === "audio/ogg" || mimeType === "audio/opus")
    return { method: "sendVoice", field: "voice", resultKey: "voice" };
  if (mimeType.startsWith("audio/")) return { method: "sendAudio", field: "audio", resultKey: "audio" };
  return { method: "sendDocument", field: "document", resultKey: "document" };
}

async function botToken(botId: string): Promise<string> {
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
async function uploadChatId(spreadsheetId: string, userId: string): Promise<string> {
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

router.post("/bots/:botId/media", requireAuth, async (req: any, res) => {
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
        `نوع فایل «${mimeType}» پشتیبانی نمی‌شود. مدیای پنل فقط می‌تواند تصویر یا فایل صوتی باشد.`,
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
    const { method, field, resultKey } = telegramTarget(mimeType);

    const form = new FormData();
    form.set("chat_id", chatId);
    form.set("disable_notification", "true");
    form.set(field, new Blob([buffer], { type: mimeType }), filename);

    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      body: form,
    });
    const payload = (await response.json()) as {
      ok: boolean;
      description?: string;
      result?: Record<string, any>;
    };

    if (!payload.ok) {
      // شکستِ سمت تلگرام خطای سرور ما نیست — پیام خودش را برگردان تا کاربر
      // بفهمد (مثلاً «bot was blocked by the user»).
      throw new BotConfigError(
        409,
        `تلگرام فایل را نپذیرفت: ${payload.description ?? "خطای نامشخص"}`,
        "telegram_rejected"
      );
    }

    // sendPhoto آرایه‌ای از اندازه‌ها می‌دهد؛ بزرگ‌ترین (آخری) همان چیزی است که
    // بات باید بفرستد.
    const result = payload.result ?? {};
    const raw = result[resultKey];
    const fileId = Array.isArray(raw) ? raw[raw.length - 1]?.file_id : raw?.file_id;
    if (!fileId) throw new BotConfigError(502, "تلگرام فایل را ذخیره کرد ولی شناسه‌ای برنگرداند.");

    // مدت صوت را خودِ تلگرام برمی‌گرداند (ثانیه). گرفتنش از اینجا از خواندن
    // دستیِ متادیتا در مرورگر دقیق‌تر است، چون این همان عددی است که کاربر
    // نهایی زیر پیام صوتی می‌بیند.
    const duration = Array.isArray(raw) ? null : typeof raw?.duration === "number" ? raw.duration : null;

    res.status(201).json({ fileId, type: resultKey, duration, mimeType });
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

export default router;
