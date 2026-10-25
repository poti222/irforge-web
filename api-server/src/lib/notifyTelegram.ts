/**
 * lib/notifyTelegram.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * تحویلِ اعلان‌های سایت در **تلگرام**.
 *
 * تا امروز `createNotification` فقط یک ردیف در جدول `notifications` می‌ساخت؛
 * یعنی کاربر تا وقتی خودش سایت را باز نمی‌کرد و روی زنگوله نمی‌زد، از تأیید
 * فیش، پاسخ تیکت یا پایان تریالش خبردار نمی‌شد. این ماژول همان اعلان را —
 * بدون هیچ تغییری در متن — از طریق **بات پلتفرم** (`TELEGRAM_BOT_TOKEN`،
 * همان باتی که کد ورود می‌فرستد) به چتِ خود کاربر هم می‌رساند.
 *
 * چرا بات پلتفرم و نه بات پشتیبانی؟ چون `users.telegramId` دقیقاً از مسیر
 * همین بات پر می‌شود (`/start <token>` در `lib/registrationBot.ts`). تلگرام
 * اجازه نمی‌دهد باتی به کاربری پیام بدهد که قبلاً با آن بات چت را شروع
 * نکرده — پس تنها باتی که تضمینی chat_id معتبر دارد همین است.
 *
 * قراردادها:
 *   - **هرگز throw نمی‌کند.** شکست تحویل فقط `logger.warn` است؛ درخواستی که
 *     اعلان را تولید کرده (خرید، تأیید فیش، …) نباید به‌خاطرش خطا بدهد.
 *   - اگر `TELEGRAM_BOT_TOKEN` تنظیم نشده باشد، بی‌صدا no-op می‌شود (محیط
 *     توسعه کردنشیال واقعی ندارد).
 *   - کاربری که `notify_telegram = false` گذاشته یا `telegram_id` ندارد،
 *     کنار گذاشته می‌شود — اعلان سایتش دست‌نخورده می‌ماند.
 */
import { eq, inArray, and } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "./logger";
import { tgApi, tgSendPhotoUpload } from "./telegram";

/**
 * فقط برای تحویلِ تلگرام (ذخیره نمی‌شود): متنِ کوتاه‌تر و/یا دکمه‌ی اختصاصی.
 * `path` نسبت به `PUBLIC_SITE_URL` است. `style` همان رنگِ دکمه‌ی Bot API است
 * (`danger` = قرمز).
 *
 * `photo` (اختیاری): عکسی که همراهِ پیام می‌رود — یا data-URL
 * (`data:image/png;base64,…`) یا مسیرِ نسبیِ هم‌مبدأ (`/api/uploads/images/<uuid>`).
 * متنِ پیام کپشنِ عکس می‌شود؛ اگر از سقفِ ۱۰۲۴ نویسه‌ی تلگرام بلندتر بود،
 * عکس بدون کپشن می‌رود و متن (با دکمه) در پیامِ بعدی. اگر عکس قابل‌ارسال نبود،
 * همان پیامِ متنیِ قبلی می‌رود — اعلان هیچ‌وقت به‌خاطر عکس گم نمی‌شود.
 */
export type TelegramOverride = {
  message?: string;
  button?: { text: string; path: string; style?: "primary" | "success" | "danger" };
  photo?: string;
};

/** سقفِ کپشنِ عکس در Bot API. */
export const TELEGRAM_CAPTION_MAX = 1024;

export type ResolvedPhoto =
  | { kind: "url"; url: string }
  | { kind: "upload"; file: Buffer; mimeType: string };

/**
 * `telegram.photo` را به چیزی تبدیل می‌کند که sendPhoto بفهمد. فقط JPEG/PNG/WebP
 * (sendPhoto از SVG و … پشتیبانی نمی‌کند)؛ هر چیزِ دیگر → `null` یعنی «بدون عکس».
 */
export function resolvePhoto(photo: string | undefined, siteUrl: string | undefined): ResolvedPhoto | null {
  if (!photo) return null;
  if (photo.startsWith("data:image/")) {
    const i = photo.indexOf(";base64,");
    if (i < 0) return null;
    const mimeType = photo.slice(5, i).toLowerCase();
    if (!/^image\/(jpeg|jpg|png|webp)$/.test(mimeType)) return null;
    const file = Buffer.from(photo.slice(i + 8), "base64");
    return file.length > 0 ? { kind: "upload", file, mimeType } : null;
  }
  // `//host` از مبدأ بیرون می‌رود؛ فقط مسیرِ هم‌مبدأ با یک اسلش.
  if (photo.startsWith("/") && !photo.startsWith("//") && siteUrl) {
    return { kind: "url", url: `${siteUrl.replace(/\/+$/, "")}${photo}` };
  }
  return null;
}

/** آیا کلِ متنِ پیام (بدون تگ‌های HTML) در کپشنِ عکس جا می‌شود؟ */
export function captionFits(input: TelegramNotificationInput): boolean {
  const body = input.telegram?.message ?? input.message;
  const plain = `${icon(input.severity, input.type)} ${input.title}\n\n${body}`;
  return Array.from(plain).length <= TELEGRAM_CAPTION_MAX;
}

export type TelegramNotificationInput = {
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  refId?: string | null;
  botId?: string | null;
  telegram?: TelegramOverride;
};

function platformToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return token ? token : null;
}

/** آیکن ابتدای پیام — تا کاربر در یک نگاه بفهمد خبر خوب است یا بد. */
function icon(severity: string, type: string): string {
  if (type.endsWith("_rejected") || type.endsWith("_failed") || type === "order_cancelled") return "❌";
  if (type.endsWith("_approved") || type.endsWith("_success") || type === "bot_deployed") return "✅";
  if (severity === "critical") return "🚨";
  if (severity === "warning") return "⚠️";
  return "🔔";
}

/** escape برای parse_mode=HTML — عنوان و متن اعلان از ورودی ادمین می‌آیند. */
function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * مقصدِ دکمه‌ی «مشاهده در سایت» بر اساس نوع اعلان.
 *
 * آینه‌ی همان مسیریابی‌ای است که فرانت در صفحه‌ی اعلان‌ها انجام می‌دهد؛ اگر
 * نوعی را نشناسیم، به خودِ صفحه‌ی اعلان‌ها می‌رود (هیچ‌وقت لینک شکسته نمی‌سازیم).
 */
export function deepLink(siteUrl: string, input: TelegramNotificationInput): string {
  const base = siteUrl.replace(/\/+$/, "");
  const { type, refId, botId } = input;
  if (type === "site_update" && refId) return `${base}/updates/${refId}`;
  if (type === "ticket_reply" || type === "ticket_closed") return refId ? `${base}/tickets/${refId}` : `${base}/tickets`;
  // IRFORGE_PROMPT_V3 Phase 16 — تیکتِ داخلِ *بات* (نه دسک پشتیبانی سایت
  // بالا)، پس مقصدش سکشن تیکت‌های همان بات است. قبل از فال‌بکِ عمومیِ
  // `bot_`/`trial_` پایین‌تر، چون این تایپ‌ها با همان پیشوند هم مطابقت
  // می‌دهند و بدون این ترتیب هرگز به شرط اختصاصی‌شان نمی‌رسیدند.
  if (type === "bot_new_ticket" || type === "bot_ticket_escalated")
    return botId ? `${base}/bots/${botId}?section=tickets` : `${base}/bots`;
  if (type.startsWith("deposit_") || type.startsWith("payment_")) return `${base}/wallet`;
  if (type === "purchase_success" || type === "purchase_failed" || type === "order_cancelled") return `${base}/invoices`;
  if (type.startsWith("trial_") || type.startsWith("bot_")) return botId ? `${base}/bots/${botId}` : `${base}/bots`;
  return `${base}/notifications`;
}

export function renderMessage(input: TelegramNotificationInput): string {
  const body = input.telegram?.message ?? input.message;
  return `${icon(input.severity, input.type)} <b>${esc(input.title)}</b>\n\n${esc(body)}`;
}

/** دکمه‌ی زیرِ پیام: اختصاصیِ اعلان (`telegram.button`) یا «مشاهده در سایت». */
export function telegramKeyboard(siteUrl: string, input: TelegramNotificationInput) {
  const custom = input.telegram?.button;
  if (custom) {
    const base = siteUrl.replace(/\/+$/, "");
    const path = custom.path.startsWith("/") ? custom.path : `/${custom.path}`;
    return {
      inline_keyboard: [[{ text: custom.text, url: `${base}${path}`, ...(custom.style ? { style: custom.style } : {}) }]],
    };
  }
  return { inline_keyboard: [[{ text: "مشاهده در سایت", url: deepLink(siteUrl, input) }]] };
}

/**
 * گیرنده‌های واجد شرایط را از بین `userIds` پیدا می‌کند: تلگرام وصل + سوئیچ روشن.
 */
async function eligibleRecipients(userIds: string[]): Promise<{ id: string; telegramId: string }[]> {
  const rows = await db
    .select({ id: usersTable.id, telegramId: usersTable.telegramId })
    .from(usersTable)
    .where(and(inArray(usersTable.id, userIds), eq(usersTable.notifyTelegram, true)));
  return rows.filter((r): r is { id: string; telegramId: string } => Boolean(r.telegramId));
}

/**
 * اعلان را برای چند کاربر در تلگرام می‌فرستد.
 *
 * ارسال‌ها **پشت‌سرهم** انجام می‌شوند نه با `Promise.all`: تلگرام برای پیام
 * انبوه حدوداً ۳۰ پیام در ثانیه سقف دارد و یک fan-out موازی روی اعلان سراسری
 * مستقیم به 429 می‌خورد. تأخیر کوچک بین ارسال‌ها ما را زیر آن سقف نگه می‌دارد.
 * چون صداکننده منتظر این تابع نمی‌ماند (fire-and-forget)، کند بودنش هیچ
 * درخواستی را بلاک نمی‌کند.
 */
export async function deliverToTelegram(
  userIds: string[],
  input: TelegramNotificationInput,
): Promise<void> {
  try {
    const token = platformToken();
    if (!token || userIds.length === 0) return;

    const recipients = await eligibleRecipients(userIds);
    if (recipients.length === 0) return;

    const siteUrl = process.env.PUBLIC_SITE_URL?.trim();
    const text = renderMessage(input);
    const reply_markup = siteUrl ? telegramKeyboard(siteUrl, input) : undefined;

    // عکسِ اختیاری. اگر متن در کپشن جا شود، پیام و دکمه همراهِ عکس می‌رود؛ وگرنه
    // عکسِ بی‌کپشن و بعدش همان پیامِ متنی.
    const photo = resolvePhoto(input.telegram?.photo, siteUrl);
    const asCaption = photo !== null && captionFits(input);
    // بعد از اولین ارسالِ موفق، `file_id` را نگه می‌داریم تا برای بقیه دوباره آپلود/دانلود نشود.
    let fileId: string | null = null;
    let photoFailures = 0;
    let photoBroken = false;

    const sendPhotoTo = (chatId: string) => {
      const caption = asCaption
        ? { caption: text, parse_mode: "HTML", ...(reply_markup ? { reply_markup } : {}) }
        : {};
      if (fileId) return tgApi(token, "sendPhoto", { chat_id: chatId, photo: fileId, ...caption });
      if (photo!.kind === "url") return tgApi(token, "sendPhoto", { chat_id: chatId, photo: photo!.url, ...caption });
      return tgSendPhotoUpload(token, {
        chat_id: chatId,
        file: photo!.file,
        mimeType: photo!.mimeType,
        ...caption,
      });
    };

    let delivered = 0;
    for (const recipient of recipients) {
      let photoDone = false;
      if (photo && !photoBroken) {
        const sent = await sendPhotoTo(recipient.telegramId);
        if (sent.ok) {
          photoDone = true;
          const sizes = (sent.result as { photo?: { file_id: string }[] } | undefined)?.photo;
          fileId ??= sizes?.length ? sizes[sizes.length - 1].file_id : null;
        } else if (!fileId && ++photoFailures >= 3) {
          // سه بار پشت‌سرهم و هنوز یک ارسالِ موفق نداشته‌ایم → مشکل از خودِ عکس است، نه گیرنده.
          photoBroken = true;
          logger.warn({ description: sent.description }, "telegram photo failed repeatedly; sending text only");
        }
      }

      // عکسِ همراهِ کپشن = پیام تحویل شده؛ در غیر این صورت (بدون عکس، عکس خراب، یا
      // کپشنِ بلند) پیامِ متنیِ همیشگی می‌رود.
      const result =
        photoDone && asCaption
          ? { ok: true as const, description: undefined }
          : await tgApi(token, "sendMessage", {
              chat_id: recipient.telegramId,
              text,
              parse_mode: "HTML",
              disable_web_page_preview: true,
              ...(reply_markup ? { reply_markup } : {}),
            });
      if (result.ok) {
        delivered++;
      } else {
        // «bot was blocked by the user» و «chat not found» رایج و بی‌ضررند —
        // فقط debug، وگرنه لاگ پر می‌شود از چیزی که کاری برایش نمی‌شود کرد.
        logger.debug(
          { userId: recipient.id, description: result.description },
          "telegram notification not delivered",
        );
      }
      if (recipients.length > 1) await new Promise((r) => setTimeout(r, 40));
    }

    logger.info(
      { type: input.type, delivered, eligible: recipients.length },
      "telegram notifications delivered",
    );
  } catch (err) {
    logger.warn({ err, type: input.type }, "deliverToTelegram failed (non-fatal)");
  }
}

/**
 * نسخه‌ی fire-and-forget — صداکننده منتظرش نمی‌ماند.
 *
 * `void` روی یک Promise ای که خودش هرگز reject نمی‌کند امن است؛ هر خطای
 * غیرمنتظره‌ای هم اینجا گرفته می‌شود تا `unhandledRejection` پروسه را نکشد.
 */
export function deliverToTelegramInBackground(
  userIds: string[],
  input: TelegramNotificationInput,
): void {
  void deliverToTelegram(userIds, input).catch((err) =>
    logger.warn({ err }, "deliverToTelegramInBackground failed (non-fatal)"),
  );
}
