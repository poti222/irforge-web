/**
 * routes/botBroadcast.ts — پیام همگانی، از طریق **صف** بات.
 * ─────────────────────────────────────────────────────────────────────────────
 * قرارداد job که `handlers/broadcast.py:237` مصرف می‌کند، مو‌به‌مو:
 *
 *   job_type = "broadcast"
 *   payload  = { bot_token, spreadsheet_id, report_chat_id, from_chat_id, message_id }
 *
 * و بدنه‌ی کار `_run_broadcast` است که با **`copy_message`** پیام
 * `(from_chat_id, message_id)` را برای هر کاربر غیر‌بن‌شده کپی می‌کند.
 *
 * دو نتیجه‌ی مستقیم از همین قرارداد، که UI هم باید صادقانه بگویدشان:
 *
 *  1. **پیام باید از قبل وجود داشته باشد.** پس سایت اول متن/مدیا را با توکن بات
 *     به چت گزارش می‌فرستد، `message_id` را می‌گیرد، و بعد job را enqueue
 *     می‌کند. چیزی که ادمین در آن چت می‌بیند، دقیقاً همان چیزی است که کاربران
 *     می‌گیرند — یک پیش‌نمایش واقعی، نه شبیه‌سازی.
 *
 *  2. **دکمه‌ی شیشه‌ای پشتیبانی نمی‌شود.** `copy_message` بدون `reply_markup`
 *     صدا زده می‌شود، پس کیبورد پیام مبدأ کپی نمی‌شود. به‌جای اینکه UI فیلد
 *     دکمه بدهد و بی‌صدا دورش بریزد، اصلاً نمی‌دهد و دلیلش را می‌گوید.
 *
 *  3. **گیرنده‌ها را خود job تعیین می‌کند** (`_recipient_ids()` = همه‌ی کاربران
 *     غیر‌بن‌شده). فیلتر دلخواه سمت سایت اثری ندارد، پس فقط یک **تخمین** تعداد
 *     نشان داده می‌شود و صریح گفته می‌شود مبنا چیست.
 */
import { Router } from "express";
import { db, botsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth.js";
import { decryptToken } from "../lib/tokenCrypto.js";
import { tgApi, downloadTelegramFile } from "../lib/telegram.js";
import { botQueueAvailable, enqueueJob, listJobs } from "../lib/botQueue.js";
import {
  resolveBotSheet,
  listEntity,
  readSettings,
  sendBotConfigError,
  BotConfigError,
} from "../lib/botConfig.js";
import { getSession } from "../lib/uploadSessions.js";
import { TELEGRAM_TEXT_LIMIT, type BotUser } from "../lib/botTypes.js";

const router = Router();

/**
 * نگاشت نوع مدیا به متد تلگرام. `voice` و `animation` هم اینجا هستند چون
 * محتوای ضبط‌شده از «ارسال با بات» می‌تواند هرکدامشان باشد — قبلاً هر چیزی
 * که عکس نبود بی‌صدا به `sendPhoto` می‌افتاد و تلگرام ردش می‌کرد.
 */
const MEDIA_METHODS: Record<string, { method: string; field: string }> = {
  photo: { method: "sendPhoto", field: "photo" },
  video: { method: "sendVideo", field: "video" },
  audio: { method: "sendAudio", field: "audio" },
  voice: { method: "sendVoice", field: "voice" },
  animation: { method: "sendAnimation", field: "animation" },
  document: { method: "sendDocument", field: "document" },
};

function queueUnavailable(): BotConfigError {
  return new BotConfigError(
    503,
    "صف بات روی این سرور پیکربندی نشده است (BOT_CACHE_DATABASE_URL)، پس ارسال همگانی ممکن نیست. ارسال مستقیم از سایت عمداً انجام نمی‌شود چون نرخ ارسال و گزارش را خود بات مدیریت می‌کند.",
    "queue_unavailable"
  );
}

/** چت گزارش: `bot_settings.media_chat_id` → آی‌دی تلگرامِ صاحب بات. */
async function reportChatId(spreadsheetId: string, userId: string): Promise<string> {
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
    "چتی برای ساخت پیام مبدأ و دریافت گزارش تعیین نشده است. حساب تلگرام‌تان را به سایت وصل کنید و یک‌بار به بات پیام بدهید، یا کلید media_chat_id را در تنظیمات بات ست کنید.",
    "no_report_chat"
  );
}

async function botToken(botId: string): Promise<string> {
  const [bot] = await db.select({ token: botsTable.token }).from(botsTable).where(eq(botsTable.id, botId)).limit(1);
  try {
    const token = decryptToken(bot?.token ?? "");
    if (token) return token;
  } catch {
    /* افتاد پایین */
  }
  throw new BotConfigError(409, "توکن این بات روی سرور در دسترس نیست.", "no_token");
}

// ─── GET /api/bots/:botId/broadcast — وضعیت + تخمین + تاریخچه ───────────────

router.get("/bots/:botId/broadcast", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);

    const users = await listEntity<BotUser>(spreadsheetId, "users");
    const eligible = users.filter((u) => u.value && typeof u.value === "object" && !(u.value as BotUser).is_banned);

    let history: Awaited<ReturnType<typeof listJobs>> = [];
    if (botQueueAvailable()) {
      try {
        history = await listJobs("broadcast", spreadsheetId, 20);
      } catch {
        // دیتابیس در دسترس نیست یا جدول ساخته نشده — تاریخچه‌ی خالی، نه خطا.
        history = [];
      }
    }

    res.json({
      queueAvailable: botQueueAvailable(),
      estimatedRecipients: eligible.length,
      totalUsers: users.length,
      // توکن هرگز در پاسخ نمی‌آید؛ payload هم قبل از ارسال به کلاینت پاک می‌شود.
      history: history.map((job) => ({
        id: job.id,
        status: job.status,
        attempts: job.attempts,
        last_error: job.last_error,
        created_at: job.created_at,
        updated_at: job.updated_at,
      })),
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to read broadcast status");
  }
});

// ─── POST /api/bots/:botId/broadcast ────────────────────────────────────────

router.post("/bots/:botId/broadcast", requireAuth, async (req: any, res) => {
  try {
    const { spreadsheetId } = await resolveBotSheet(req.userId, req.params.botId);
    if (!botQueueAvailable()) throw queueUnavailable();

    let text = String(req.body?.text ?? "");
    let mediaFileId = String(req.body?.mediaFileId ?? "").trim();
    let mediaType = String(req.body?.mediaType ?? "").trim();
    /** `entities` تلگرام — فقط از مسیر «ارسال با بات» می‌آید. */
    let entities: unknown = null;
    /** file_id متعلق به **بات پلتفرم** — باید دانلود و دوباره آپلود شود. */
    let capturedFileId = "";

    // ── محتوای ضبط‌شده از تلگرام («ارسال با بات») ─────────────────────────
    //
    // پیامی که کاربر به بات پلتفرم داده در چتی است که بات تننت عضوش نیست،
    // پس `copy_message` مستقیم بینشان کار نمی‌کند.
    //
    // ⚠️ و **file_id هم قابل انتقال بین دو بات نیست** — مستندات Bot API
    // صریح می‌گوید file_id برای هر بات یکتاست. فرستادنش با توکن بات دیگر
    // خطای `wrong file identifier/HTTP URL specified` می‌دهد. (این دقیقاً
    // همان باگی بود که در عمل دیده شد.)
    //
    // پس تنها راه درست: بایت‌ها با توکن **بات پلتفرم** دانلود و با توکن
    // **بات تننت** دوباره آپلود می‌شوند. متن و `entities` هم عیناً منتقل
    // می‌شوند تا فرمت حفظ شود.
    const sessionId = String(req.body?.uploadSessionId ?? "").trim();
    if (sessionId) {
      const session = await getSession(sessionId, req.userId);
      if (!session) throw new BotConfigError(404, "این جلسه‌ی ارسال پیدا نشد.", "session_not_found");
      if (session.status !== "filled")
        throw new BotConfigError(
          409,
          "هنوز پیامی از تلگرام دریافت نشده است.",
          "session_not_filled"
        );
      text = session.content ?? "";
      mediaType = session.mediaType === "text" ? "" : (session.mediaType ?? "");
      entities = session.entities ?? null;
      capturedFileId = session.fileId ?? "";
      // `mediaFileId` عمداً ست نمی‌شود: آن مسیر یعنی «این file_id مال همین
      // بات است». فایلِ ضبط‌شده مال بات پلتفرم است و باید دوباره آپلود شود.
      mediaFileId = "";
    }

    if (!text.trim() && !mediaFileId && !capturedFileId)
      throw new BotConfigError(400, "پیام همگانی نمی‌تواند خالی باشد.");
    if (text.length > TELEGRAM_TEXT_LIMIT)
      throw new BotConfigError(400, `طول پیام از ${TELEGRAM_TEXT_LIMIT} کاراکتر بیشتر است (سقف تلگرام).`);

    // تأیید دو مرحله‌ای: کلاینت باید تعداد گیرندگانی را که دیده، عیناً پس بفرستد.
    // اگر بین دیدن و زدن دکمه، تعداد عوض شده باشد، درخواست رد می‌شود.
    const users = await listEntity<BotUser>(spreadsheetId, "users");
    const eligible = users.filter((u) => u.value && typeof u.value === "object" && !(u.value as BotUser).is_banned);
    const confirmed = Number(req.body?.confirmRecipients);
    if (!Number.isInteger(confirmed) || confirmed !== eligible.length)
      throw new BotConfigError(
        409,
        `تعداد گیرندگان از وقتی صفحه را باز کردید عوض شده است (الان ${eligible.length} نفر). یک‌بار دیگر تأیید کنید.`,
        "recipient_count_changed"
      );

    const chatId = await reportChatId(spreadsheetId, req.userId);
    const token = await botToken(req.params.botId);

    // گام ۱ — ساخت پیام مبدأ. `copy_message` بات از روی همین کپی می‌گیرد، پس
    // آنچه ادمین در این چت می‌بیند دقیقاً همان چیزی است که کاربران می‌گیرند.
    let sent: { ok: boolean; description?: string; result?: { message_id: number } };
    if (capturedFileId) {
      // بایت‌ها را از بات پلتفرم بگیر و با توکن بات تننت دوباره آپلود کن.
      const platformToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
      if (!platformToken)
        throw new BotConfigError(
          503,
          "بات پلتفرم روی این سرور تنظیم نشده، پس محتوای ضبط‌شده قابل ارسال نیست.",
          "no_platform_token"
        );

      const file = await downloadTelegramFile(platformToken, capturedFileId);
      if (!file)
        throw new BotConfigError(
          409,
          "فایلی که در تلگرام فرستادید دیگر در دسترس نیست. یک‌بار دیگر «ارسال با بات» را بزنید.",
          "captured_file_gone"
        );

      const { method, field } = MEDIA_METHODS[mediaType] ?? MEDIA_METHODS.photo;
      const form = new FormData();
      form.set("chat_id", chatId);
      form.set(field, new Blob([file.buffer], { type: file.contentType }), file.fileName);
      if (text) {
        form.set("caption", text);
        if (entities) form.set("caption_entities", JSON.stringify(entities));
      }

      const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        body: form,
      });
      sent = (await response.json()) as typeof sent;
    } else if (mediaFileId) {
      const { method, field } = MEDIA_METHODS[mediaType] ?? MEDIA_METHODS.photo;
      sent = await tgApi(token, method, {
        chat_id: chatId,
        [field]: mediaFileId,
        caption: text || undefined,
        // `caption_entities` فقط وقتی معنی دارد که کپشنی باشد. اگر فرستاده
        // شود ولی کپشن خالی باشد، تلگرام کل درخواست را رد می‌کند.
        ...(entities && text ? { caption_entities: entities } : {}),
      });
    } else {
      sent = await tgApi(token, "sendMessage", {
        chat_id: chatId,
        text,
        ...(entities ? { entities } : {}),
      });
    }

    if (!sent.ok || !sent.result?.message_id)
      throw new BotConfigError(
        409,
        `تلگرام پیام مبدأ را نپذیرفت: ${sent.description ?? "خطای نامشخص"}`,
        "telegram_rejected"
      );

    // گام ۲ — enqueue با دقیقاً همان کلیدهایی که `_broadcast_job_handler`
    // می‌خواند. کم/زیادشان یعنی job سمت بات با KeyError می‌افتد.
    const jobId = await enqueueJob("broadcast", {
      bot_token: token,
      spreadsheet_id: spreadsheetId,
      report_chat_id: chatId,
      from_chat_id: chatId,
      message_id: sent.result.message_id,
    });

    res.status(202).json({
      jobId,
      estimatedRecipients: eligible.length,
      reportChatId: chatId,
    });
  } catch (err) {
    sendBotConfigError(res, err, "Failed to enqueue broadcast");
  }
});

export default router;
