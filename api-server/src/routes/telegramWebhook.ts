/**
 * routes/telegramWebhook.ts — G8: "اتصال با ربات"
 *
 * تلگرام آپدیت‌های بات پلتفرم (TELEGRAM_BOT_TOKEN) رو اینجا POST می‌کنه.
 * تنها چیزی که برامون مهمه پیام /start <token> هست: توکنی که
 * POST /api/auth/telegram/link/start ساخته رو پیدا می‌کنه، مصرفش می‌کنه و
 * حساب تلگرام فرستنده رو به کاربر صاحب اون توکن وصل می‌کنه.
 *
 * امنیت: تلگرام هدر X-Telegram-Bot-Api-Secret-Token رو با مقداری که موقع
 * setWebhook دادیم (registerTelegramWebhookIfConfigured) برمی‌گردونه؛ بدون
 * تطابق این هدر، درخواست نادیده گرفته می‌شه.
 *
 * همیشه سریع 200 برمی‌گردونیم تا تلگرام رو retry-storm نکنیم؛ خطاها فقط لاگ
 * می‌شن.
 */
import { Router } from "express";
import crypto from "crypto";
import { db, usersTable, telegramLinkTokensTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendTelegramMessage, telegramWebhookSecret, getTelegramUserPhotoFileId } from "../lib/telegram";

const router = Router();

function timingEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

router.post("/telegram/webhook", async (req, res) => {
  // پاسخ فوری — بقیه‌ی کار async و best-effort انجام می‌شه
  res.status(200).json({ ok: true });

  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return;

    const expected = telegramWebhookSecret(botToken);
    const provided = req.headers["x-telegram-bot-api-secret-token"];
    if (typeof provided !== "string" || !timingEqual(provided, expected)) {
      logger.warn("Telegram webhook: invalid or missing secret token");
      return;
    }

    const message = req.body?.message;
    const text: string | undefined = message?.text;
    const from = message?.from;
    const chat = message?.chat;
    if (!text || !from || !chat || from.is_bot) return;
    if (!text.startsWith("/start")) return;

    const chatId = String(chat.id);
    const token = text.trim().split(/\s+/)[1];

    if (!token) {
      await sendTelegramMessage(
        botToken,
        chatId,
        "سلام! برای اتصال حساب تلگرام به IRForge، از داخل پروفایل سایت روی «اتصال با ربات» بزنید."
      );
      return;
    }

    const now = new Date();
    const [row] = await db
      .select()
      .from(telegramLinkTokensTable)
      .where(eq(telegramLinkTokensTable.token, token))
      .limit(1);

    if (!row || row.used || row.expiresAt < now) {
      await sendTelegramMessage(
        botToken,
        chatId,
        "این لینک اتصال منقضی یا نامعتبر است. لطفاً از داخل سایت دوباره روی «اتصال با ربات» بزنید."
      );
      return;
    }

    const telegramId = String(from.id);
    const existing = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.telegramId, telegramId))
      .limit(1);
    if (existing[0] && existing[0].id !== row.userId) {
      await sendTelegramMessage(
        botToken,
        chatId,
        "این حساب تلگرام قبلاً به یک حساب دیگر در IRForge وصل شده است."
      );
      return;
    }

    // توکن رو قبل از فراخوانی‌های شبکه‌ای مصرف کن (single-use، جلوگیری از
    // مصرف دوباره در صورت retry همزمان تلگرام)
    const consumed = await db
      .update(telegramLinkTokensTable)
      .set({ used: true })
      .where(and(eq(telegramLinkTokensTable.token, token), eq(telegramLinkTokensTable.used, false)))
      .returning();
    if (consumed.length === 0) return; // یه درخواست موازی دیگه قبلاً مصرفش کرده

    const photoFileId = await getTelegramUserPhotoFileId(botToken, from.id);
    const photoProxyUrl = photoFileId ? `/api/users/${row.userId}/telegram-photo` : null;

    const updateData: Record<string, any> = {
      telegramId,
      telegramUsername: from.username ?? null,
      telegramFirstName: from.first_name,
      telegramLastName: from.last_name ?? null,
      telegramPhotoFileId: photoFileId,
      telegramPhotoUrl: photoProxyUrl,
    };
    if (photoProxyUrl) updateData.avatar = photoProxyUrl;

    await db.update(usersTable).set(updateData).where(eq(usersTable.id, row.userId));

    await sendTelegramMessage(botToken, chatId, "✅ حساب تلگرام شما با موفقیت به IRForge متصل شد.");
  } catch (err) {
    logger.error({ err }, "Telegram webhook error");
  }
});

export default router;
