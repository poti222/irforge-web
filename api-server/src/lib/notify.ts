/**
 * lib/notify.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * تنها راه ساختِ ردیف در جدول `notifications` از داخل route ها.
 *
 * تا پیش از این، فقط `lib/trial.ts` اعلان می‌ساخت (trial_warning /
 * trial_expired) و هیچ رویداد واقعیِ دیگری — خرید، تأیید فیش، پاسخ تیکت،
 * اعلان سراسری — اعلانی تولید نمی‌کرد.
 *
 * قرارداد مهم: این توابع **هرگز throw نمی‌کنند**. دقیقاً مثل
 * `sendTelegramMessage`، اگر ساختِ اعلان شکست بخورد فقط `logger.warn` می‌شود.
 * تحویلِ اعلان هیچ‌وقت نباید درخواستی که آن را تولید کرده (مثلاً خرید بات)
 * را با شکست مواجه کند.
 */
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import { logger } from "./logger";

export type NotificationSeverity = "info" | "warning" | "critical";

export type NotificationInput = {
  userId: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  botId?: string | null;
  dedupeKey?: string | null;
  /**
   * ارجاع اختیاری به رکوردی که اعلان درباره‌اش است (مثلاً id یک site update).
   * فرانت از روی آن لینک مقصد را می‌سازد؛ بدون این، اعلان فقط از روی `type`
   * قابل مسیریابی بود و نمی‌شد به یک رکورد مشخص اشاره کرد.
   */
  refId?: string | null;
};

/**
 * یک اعلان برای یک کاربر می‌سازد.
 *
 * اگر `dedupeKey` داده شود و ردیفی با همان `(userId, dedupeKey)` وجود داشته
 * باشد، هیچ کاری نمی‌کند (no-op) — تا retry نتواند اعلان تکراری بسازد.
 */
export async function createNotification(input: NotificationInput): Promise<void> {
  try {
    if (input.dedupeKey) {
      const existing = await db
        .select({ id: notificationsTable.id })
        .from(notificationsTable)
        .where(and(
          eq(notificationsTable.userId, input.userId),
          eq(notificationsTable.dedupeKey, input.dedupeKey),
        ))
        .limit(1);
      if (existing.length > 0) return;
    }

    await db.insert(notificationsTable).values({
      id: crypto.randomUUID(),
      userId: input.userId,
      botId: input.botId ?? null,
      type: input.type,
      severity: input.severity,
      title: input.title,
      message: input.message,
      read: false,
      dedupeKey: input.dedupeKey ?? null,
      refId: input.refId ?? null,
    });
  } catch (err) {
    logger.warn({ err, type: input.type, userId: input.userId }, "createNotification failed (non-fatal)");
  }
}

/**
 * همان `createNotification` ولی برای چند کاربر، با یک insert دسته‌ای — برای
 * fan-out اعلان سراسری، تا به‌ازای هر کاربر یک رفت‌وبرگشت به دیتابیس نزنیم.
 *
 * `dedupeKey` در اینجا بین همه‌ی کاربران مشترک است (مثلاً
 * `announcement:<id>`)، بنابراین کاربرانی که قبلاً همان اعلان را گرفته‌اند از
 * لیست کنار گذاشته می‌شوند و بقیه در یک insert ساخته می‌شوند.
 */
export async function createNotificationsBulk(
  userIds: string[],
  input: Omit<NotificationInput, "userId">,
): Promise<void> {
  try {
    if (userIds.length === 0) return;

    let targets = userIds;
    if (input.dedupeKey) {
      const already = await db
        .select({ userId: notificationsTable.userId })
        .from(notificationsTable)
        .where(eq(notificationsTable.dedupeKey, input.dedupeKey));
      const seen = new Set(already.map((r) => r.userId));
      targets = userIds.filter((id) => !seen.has(id));
    }
    if (targets.length === 0) return;

    await db.insert(notificationsTable).values(
      targets.map((userId) => ({
        id: crypto.randomUUID(),
        userId,
        botId: input.botId ?? null,
        type: input.type,
        severity: input.severity,
        title: input.title,
        message: input.message,
        read: false,
        dedupeKey: input.dedupeKey ?? null,
        refId: input.refId ?? null,
      })),
    );
  } catch (err) {
    logger.warn({ err, type: input.type, count: userIds.length }, "createNotificationsBulk failed (non-fatal)");
  }
}

/**
 * مبلغ را برای متنِ فارسی اعلان قالب‌بندی می‌کند (جداکننده‌ی هزارگان + «تومان»).
 * اعلانی که فقط بگوید «پرداخت انجام شد» بی‌فایده‌ست؛ مبلغ باید داخل متن باشد.
 */
export function formatTomanFa(amount: number): string {
  return `${Math.round(amount).toLocaleString("fa-IR")} تومان`;
}

/** نگاشتِ `announcements.type` به severity اعلانِ per-user. */
export function severityForAnnouncementType(type: string | null | undefined): NotificationSeverity {
  if (type === "error") return "critical";
  if (type === "warning") return "warning";
  return "info";
}
