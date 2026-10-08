/**
 * lib/botTokenHealth.ts — «توکنِ بات نامعتبر شد ⇒ بات خاموش، تا توکنِ معتبر وارد شود».
 * ─────────────────────────────────────────────────────────────────────────────
 * ران‌تایمِ بات (irforge-app / bot_manager) روی Unauthorized تننت را در رجیستری `token_invalid` می‌کند و دیگر بالا نمی‌آوَردش؛
 * ولی سایت از آن خبر نداشت (وضعیتِ بات «active» می‌ماند، کاربر هشداری نمی‌دید). این فایل دو کار می‌کند:
 *   ۱. `markBotTokenInvalid`: وضعیتِ بات در Postgres و رجیستری → `token_invalid` (خاموشیِ فوری)، هشدارِ بحرانی به مالک.
 *   ۲. `sweepBotTokens`: هر دور (از botLifecycle) چند باتِ فعال را (قدیمی‌ترینِ چک‌شده اول) با `getMe` می‌سنجد؛ فقط ۴۰۱/Unauthorized نامعتبر حساب می‌شود، خطای شبکه/۵xx هرگز.
 * با توکنِ معتبرِ جدید (PATCH /bots/:id) وضعیت به `active` برمی‌گردد (routes/bots.ts).
 */
import { db, botsTable, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger.js";
import { createNotification } from "./notify.js";
import { decryptToken } from "./tokenCrypto.js";
import { tgApi } from "./telegram.js";
import { syncBotUpsert, syncTenantUpsert } from "./sheetsSync.js";

export const TOKEN_INVALID_STATUS = "token_invalid";
export const TOKEN_CHECKS_PER_SWEEP = 40;
/** حداقل فاصله‌ی دو چکِ getMe برایِ یک بات. */
export const TOKEN_RECHECK_MS = 60 * 60 * 1000;

type BotRow = typeof botsTable.$inferSelect;

/** true فقط وقتی تلگرام قطعاً توکن را رد کرده (۴۰۱)؛ هر خطایِ دیگر (شبکه، ۴۲۹، ۵xx) → false. */
export async function isTokenRejectedByTelegram(token: string): Promise<boolean> {
  try {
    const r = (await tgApi(token, "getMe")) as { ok: boolean; error_code?: number };
    return r.ok === false && r.error_code === 401;
  } catch {
    return false;
  }
}

export async function markBotTokenInvalid(bot: BotRow, source: "check" | "telegram_401"): Promise<boolean> {
  const [updated] = await db.update(botsTable).set({ status: TOKEN_INVALID_STATUS })
    .where(and(eq(botsTable.id, bot.id), eq(botsTable.status, "active"))).returning();
  if (!updated) return false;
  try {
    const token = decryptToken(bot.token);
    if (bot.sheetId) {
      const [owner] = await db.select({ telegramId: usersTable.telegramId }).from(usersTable).where(eq(usersTable.id, bot.userId)).limit(1);
      syncTenantUpsert({
        bot_token: token, bot_name: bot.name, bot_username: bot.username, owner_user_id: bot.userId,
        owner_telegram_id: owner?.telegramId ?? null, sheet_id: bot.sheetId, admin_password: bot.adminCode ?? "",
        status: TOKEN_INVALID_STATUS, created_at: bot.createdAt,
      });
    }
  } catch (err) {
    logger.warn({ err, botId: bot.id }, "markBotTokenInvalid: registry sync failed (non-fatal)");
  }
  syncBotUpsert({
    id: updated.id, userId: updated.userId, name: updated.name, username: updated.username, status: updated.status,
    commandCount: updated.commandCount, pluginCount: updated.pluginCount, userCount: updated.userCount,
    messageCount: updated.messageCount, createdAt: updated.createdAt, updatedAt: updated.updatedAt,
  });
  await createNotification({
    userId: bot.userId,
    botId: bot.id,
    type: "bot_token_invalid",
    severity: "critical",
    title: "توکنِ بات نامعتبر شد — بات خاموش است",
    message: `تلگرام توکنِ بات «${bot.name}» را قبول نمی‌کند (احتمالاً از BotFather عوض یا باطل شده). بات تا وارد کردنِ توکنِ معتبر خاموش می‌ماند؛ از بخشِ «نمای کلی» همان بات توکنِ جدید را وارد کنید.`,
    dedupeKey: `bot-token-invalid:${bot.id}:${bot.token.slice(-12)}`,
  });
  logger.warn({ botId: bot.id, source }, "bot token invalid — bot switched off");
  return true;
}

const lastChecked = new Map<string, number>();

export async function sweepBotTokens(): Promise<{ marked: number }> {
  let marked = 0;
  let active: BotRow[];
  try {
    active = await db.select().from(botsTable).where(eq(botsTable.status, "active"));
  } catch (err) {
    logger.error({ err }, "sweepBotTokens: failed to load bots");
    return { marked };
  }

  // ۲) چکِ مستقیمِ getMe برایِ قدیمی‌ترین‌های چک‌نشده.
  const now = Date.now();
  const due = active
    .filter((b) => b.status === "active" && now - (lastChecked.get(b.id) ?? 0) >= TOKEN_RECHECK_MS)
    .sort((a, b) => (lastChecked.get(a.id) ?? 0) - (lastChecked.get(b.id) ?? 0))
    .slice(0, TOKEN_CHECKS_PER_SWEEP);
  for (const bot of due) {
    lastChecked.set(bot.id, now);
    let plain = "";
    try { plain = decryptToken(bot.token); } catch { continue; }
    if (await isTokenRejectedByTelegram(plain) && (await markBotTokenInvalid(bot, "check"))) marked += 1;
  }
  return { marked };
}
