/**
 * lib/trial.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * منطق تریال ۷ روزه. چون سرور job زمان‌بندی‌شده (cron) ندارد، وضعیت هر بات
 * تریال به‌صورت lazy — یعنی هر بار که این بات از دیتابیس خوانده می‌شود
 * (GET /bots, GET /bots/:id, GET /notifications) — دوباره محاسبه می‌شود:
 *
 *   - اگر روزهای باقی‌مانده ۳، ۲ یا ۱ باشد → یک اعلان هشدار برای همان روز
 *     ساخته می‌شود (اگر قبلاً ساخته نشده — با dedupeKey).
 *   - اگر تریال تمام شده باشد → status بات به "expired" تغییر می‌کند و یک
 *     اعلان نهایی ساخته می‌شود.
 *
 * حذف واقعی داده‌ها بعد از انقضا فعلاً پیاده‌سازی نشده (تصمیم محصولی: فعلاً
 * فقط قطع سرویس + اعلان، حذف دیتا بعداً).
 */
import crypto from "crypto";
import { eq, and } from "drizzle-orm";
import { db, botsTable, notificationsTable, type Bot } from "@workspace/db";
import { logger } from "./logger";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** از این تعداد روز مانده به بعد، هر روز یک اعلان هشدار ساخته می‌شود. */
const WARNING_WINDOW_DAYS = 3;

export function trialDaysLeft(trialExpiresAt: Date | string | null): number | null {
  if (!trialExpiresAt) return null;
  const expiresAt = trialExpiresAt instanceof Date ? trialExpiresAt : new Date(trialExpiresAt);
  return Math.ceil((expiresAt.getTime() - Date.now()) / MS_PER_DAY);
}

async function createNotificationOnce(params: {
  userId: string;
  botId: string;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  dedupeKey: string;
}) {
  try {
    await db.insert(notificationsTable).values({
      id: crypto.randomUUID(),
      userId: params.userId,
      botId: params.botId,
      type: params.type,
      severity: params.severity,
      title: params.title,
      message: params.message,
      read: false,
      dedupeKey: params.dedupeKey,
    });
  } catch (err: any) {
    // نقض unique index روی dedupe_key یعنی این اعلان قبلاً ساخته شده — بی‌خطر نادیده بگیر.
    if (err?.code !== "23505") {
      logger.error({ err }, "Failed to create trial notification");
    }
  }
}

/**
 * وضعیت تریال یک بات را ارزیابی می‌کند: در صورت لزوم status را در دیتابیس
 * به "expired" آپدیت می‌کند و اعلان مناسب را می‌سازد. یک نسخه‌ی (احتمالاً)
 * به‌روزشده از بات را برمی‌گرداند تا صدا‌زننده مجبور به کوئری دوباره نباشد.
 */
export async function evaluateBotTrial(bot: Bot): Promise<Bot> {
  if (!bot.isTrial || !bot.trialExpiresAt) return bot;

  const daysLeft = trialDaysLeft(bot.trialExpiresAt);
  if (daysLeft === null) return bot;

  if (daysLeft <= 0) {
    if (bot.status !== "expired") {
      await db.update(botsTable).set({ status: "expired" }).where(eq(botsTable.id, bot.id));
    }
    await createNotificationOnce({
      userId: bot.userId,
      botId: bot.id,
      type: "trial_expired",
      severity: "critical",
      title: "دوره تریال به پایان رسید",
      message: `تریال ۷ روزه‌ی بات «${bot.name}» تمام شد و سرویس آن قطع شد. برای ادامه، یکی از پکیج‌ها را از صفحه‌ی «خرید بات» تهیه کن.`,
      dedupeKey: `trial:${bot.id}:expired`,
    });
    return { ...bot, status: "expired" };
  }

  if (daysLeft <= WARNING_WINDOW_DAYS) {
    await createNotificationOnce({
      userId: bot.userId,
      botId: bot.id,
      type: "trial_warning",
      severity: "warning",
      title: `${daysLeft} روز تا پایان تریال باقی مانده`,
      message: `تریال بات «${bot.name}» تا ${daysLeft} روز دیگر تمام می‌شود و سرویس قطع خواهد شد. برای جلوگیری از قطعی، یکی از پکیج‌ها را از صفحه‌ی «خرید بات» تهیه کن.`,
      dedupeKey: `trial:${bot.id}:warn:${daysLeft}`,
    });
  }

  return bot;
}

/** همه‌ی بات‌های تریالِ یک کاربر را ارزیابی می‌کند (برای GET /notifications). */
export async function evaluateUserTrials(userId: string): Promise<void> {
  const trialBots = await db
    .select()
    .from(botsTable)
    .where(and(eq(botsTable.userId, userId), eq(botsTable.isTrial, true)));
  for (const bot of trialBots) {
    await evaluateBotTrial(bot);
  }
}
