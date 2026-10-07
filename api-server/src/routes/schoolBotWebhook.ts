/**
 * routes/schoolBotWebhook.ts — تلگرام آپدیت‌هایِ باتِ **هر مدرسه** را روی مسیرِ اختصاصیِ خودش می‌فرستد:
 * `/api/schools/bot-webhook/:schoolBotId` با هدرِ `X-Telegram-Bot-Api-Secret-Token` = telegramWebhookSecret(توکنِ همان بات).
 * منطقِ بات (start/منوها/دکمه‌ها): lib/schoolBot/handler.ts.
 * قرارداد: سکرتِ نادرست → ۴۰۱ (بدونِ پردازش)؛ درست → فوراً ۲۰۰ و پردازش پس از آن؛ خطاها فقط لاگ می‌شوند.
 * (باگِ قدیمیِ «Start بی‌جواب»: توکن را از `school_bots.botToken` می‌خواند که وجود ندارد — اکنون getSchoolBotToken از استخر.)
 */
import { Router } from "express";
import crypto from "crypto";
import { db, schoolBotsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getSchoolBotToken } from "../lib/schoolBotCore";
import { telegramWebhookSecret } from "../lib/telegram";
import { handleUpdate } from "../lib/schoolBot/handler";

const router = Router();

function timingEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

router.post("/schools/bot-webhook/:schoolBotId", async (req: any, res) => {
  try {
    const [bot] = await db.select().from(schoolBotsTable).where(eq(schoolBotsTable.id, req.params.schoolBotId)).limit(1);
    if (!bot) { res.status(404).end(); return; }
    const token = await getSchoolBotToken(bot);
    if (!token) { res.status(200).end(); return; }
    const received = req.header("X-Telegram-Bot-Api-Secret-Token") ?? "";
    if (!received || !timingEqual(received, telegramWebhookSecret(token))) {
      logger.warn({ schoolBotId: bot.id }, "school bot webhook: secret token mismatch, rejecting");
      res.status(401).end();
      return;
    }
    res.status(200).end();
    await handleUpdate(bot, token, req.body);
  } catch (err) {
    logger.error({ err }, "school bot webhook handler error");
    if (!res.headersSent) res.status(200).end();
  }
});

export default router;
