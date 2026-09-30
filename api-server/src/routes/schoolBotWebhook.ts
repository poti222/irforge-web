/**
 * routes/schoolBotWebhook.ts — بخش "/schools" فاز ۷ (بخش B): تلگرام آپدیت‌هایِ
 * باتِ **هر مدرسه** را روی مسیرِ اختصاصیِ خودش می‌فرستد.
 * ─────────────────────────────────────────────────────────────────────────
 * چرا یک روتِ جدا از routes/telegramWebhook.ts: آن فایل فقط باتِ **پلتفرم**
 * (یک توکنِ ثابتِ TELEGRAM_BOT_TOKEN) را می‌شناسد و امضایِ امنیتی‌اش
 * (X-Telegram-Bot-Api-Secret-Token) را با همان یک توکن می‌سنجد. هر باتِ
 * مدرسه توکنِ خودش را دارد (از استخر)، پس مسیر خودش را هم دارد —
 * `/api/schools/bot-webhook/:schoolBotId` — و امضا با
 * telegramWebhookSecret(TOKEN_HAMAN_BOT) سنجیده می‌شود، دقیقاً همان تابعِ
 * lib/telegram.ts که باتِ پلتفرم هم استفاده می‌کند، فقط با توکنِ متفاوت.
 *
 * تنها کاری که این وبهوک انجام می‌دهد: `/start <token>` → اگر توکن معتبر
 * (تازه/مصرف‌نشده) و برایِ همین بات باشد، chat_id فرستنده را در
 * school_bot_subscribers ثبت می‌کند. هیچ چیزِ دیگری (بدونِ منویِ فرمان،
 * بدونِ رجیستریشن) — این بات فقط برایِ اطلاع‌رسانیِ یک‌طرفه است.
 *
 * همیشه سریع 200 برمی‌گرداند (retry-storm تلگرام را نمی‌خواهیم)، خطاها فقط لاگ می‌شوند.
 */
import { Router } from "express";
import crypto from "crypto";
import { db, schoolBotsTable, schoolBotLinkTokensTable, schoolBotSubscribersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import { decryptToken } from "../lib/tokenCrypto";
import { tgApi, telegramWebhookSecret } from "../lib/telegram";

const router = Router();

function timingEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

router.post("/api/schools/bot-webhook/:schoolBotId", async (req: any, res) => {
  // همیشه سریع 200 — همان قراردادِ routes/telegramWebhook.ts.
  res.status(200).end();

  try {
    const { schoolBotId } = req.params;
    const [bot] = await db.select().from(schoolBotsTable).where(eq(schoolBotsTable.id, schoolBotId)).limit(1);
    if (!bot) return;

    let token: string;
    try {
      token = decryptToken(bot.botToken as unknown as string);
    } catch (err) {
      logger.warn({ err, schoolBotId }, "school bot webhook: token decrypt failed");
      return;
    }

    const expected = telegramWebhookSecret(token);
    const received = req.header("X-Telegram-Bot-Api-Secret-Token") ?? "";
    if (!received || !timingEqual(received, expected)) {
      logger.warn({ schoolBotId }, "school bot webhook: secret token mismatch, ignoring");
      return;
    }

    const message = req.body?.message;
    const text: string | undefined = message?.text;
    const chatId: number | undefined = message?.chat?.id;
    if (!text || !chatId || !text.startsWith("/start ")) return;

    const linkToken = text.slice("/start ".length).trim();
    if (!linkToken) return;

    const [row] = await db.select().from(schoolBotLinkTokensTable)
      .where(and(eq(schoolBotLinkTokensTable.token, linkToken), eq(schoolBotLinkTokensTable.schoolBotId, bot.id)))
      .limit(1);
    if (!row || row.used || row.expiresAt < new Date()) {
      await tgApi(token, "sendMessage", { chat_id: chatId, text: "این لینک منقضی یا نامعتبر است. از داخلِ سایت دوباره لینکِ تازه بگیرید." });
      return;
    }

    // مصرفِ اتمیک — همان الگویِ روتِ platform (WHERE token=... AND used=false)
    // تا یک retry دوباره ردیفِ subscriber نسازد.
    const [consumed] = await db.update(schoolBotLinkTokensTable)
      .set({ used: true })
      .where(and(eq(schoolBotLinkTokensTable.token, linkToken), eq(schoolBotLinkTokensTable.used, false)))
      .returning();
    if (!consumed) return; // یک آپدیتِ دیگر (retry) قبلاً همین را مصرف کرده.

    const [existingSub] = await db.select().from(schoolBotSubscribersTable)
      .where(and(eq(schoolBotSubscribersTable.schoolBotId, bot.id), eq(schoolBotSubscribersTable.userId, row.userId)))
      .limit(1);
    if (existingSub) {
      await db.update(schoolBotSubscribersTable).set({ telegramChatId: String(chatId) }).where(eq(schoolBotSubscribersTable.id, existingSub.id));
    } else {
      await db.insert(schoolBotSubscribersTable).values({
        id: crypto.randomUUID(),
        schoolBotId: bot.id,
        userId: row.userId,
        telegramChatId: String(chatId),
      });
    }

    await tgApi(token, "sendMessage", { chat_id: chatId, text: "✅ اتصال برقرار شد. از این پس اعلان‌های مدرسه از همین‌جا برایتان ارسال می‌شود." });
  } catch (err) {
    logger.error({ err }, "school bot webhook handler error");
  }
});

export default router;
