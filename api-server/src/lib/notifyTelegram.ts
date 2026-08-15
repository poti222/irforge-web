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
import { tgApi } from "./telegram";

export type TelegramNotificationInput = {
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  refId?: string | null;
  botId?: string | null;
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
  if (type.startsWith("deposit_") || type.startsWith("payment_")) return `${base}/wallet`;
  if (type === "purchase_success" || type === "purchase_failed" || type === "order_cancelled") return `${base}/invoices`;
  if (type.startsWith("trial_") || type.startsWith("bot_")) return botId ? `${base}/bots/${botId}` : `${base}/bots`;
  return `${base}/notifications`;
}

export function renderMessage(input: TelegramNotificationInput): string {
  return `${icon(input.severity, input.type)} <b>${esc(input.title)}</b>\n\n${esc(input.message)}`;
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
    const reply_markup = siteUrl
      ? { inline_keyboard: [[{ text: "مشاهده در سایت", url: deepLink(siteUrl, input) }]] }
      : undefined;

    let delivered = 0;
    for (const recipient of recipients) {
      const result = await tgApi(token, "sendMessage", {
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
