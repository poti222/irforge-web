/**
 * lib/schoolBotCore.ts — هستهٔ مشترکِ باتِ مدرسه: گرفتنِ توکنِ بات، ثبتِ webhook، همگام‌سازیِ پروفایل
 * (نام/عکس/توضیح/دستورها/دکمهٔ منو) و عیب‌یابی.
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ باگِ ریشه‌ایِ «استارت می‌زنم هیچ‌چیز نمی‌شود»: `school_bots` ستونِ توکن ندارد — توکنِ رمزشده در
 * `school_bot_token_pool.bot_token` است و `school_bots.bot_token_pool_id` به آن اشاره می‌کند. وب‌هوک و اعلان‌ها
 * `bot.botToken` را می‌خواندند (همیشه undefined) → decryptToken throw می‌کرد → خطا فقط در لاگ (warn) گم می‌شد و
 * هیچ‌وقت چیزی به تلگرام برنمی‌گشت. همه باید از `getSchoolBotToken` استفاده کنند.
 */
import { eq } from "drizzle-orm";
import { db, schoolBotsTable, schoolBotTokenPoolTable, schoolsTable } from "@workspace/db";
import { logger } from "./logger";
import { decryptToken } from "./tokenCrypto";
import { tgApi, telegramWebhookSecret } from "./telegram";

export type SchoolBotRow = typeof schoolBotsTable.$inferSelect;

/** هر دو نوعِ آپدیتی که باتِ مدرسه می‌فهمد. (callback_query = دکمه‌هایِ شیشه‌ای.) */
export const SCHOOL_BOT_ALLOWED_UPDATES = ["message", "callback_query"];

/** توکنِ متنِ خامِ یک باتِ مدرسه (از استخر)؛ null اگر نشد (و دلیل لاگ می‌شود — نه بی‌صدا). */
export async function getSchoolBotToken(bot: Pick<SchoolBotRow, "id" | "botTokenPoolId">): Promise<string | null> {
  try {
    const [p] = await db.select({ botToken: schoolBotTokenPoolTable.botToken }).from(schoolBotTokenPoolTable)
      .where(eq(schoolBotTokenPoolTable.id, bot.botTokenPoolId)).limit(1);
    if (!p) {
      logger.error({ schoolBotId: bot.id, poolId: bot.botTokenPoolId }, "school bot: pool row missing");
      return null;
    }
    return decryptToken(p.botToken);
  } catch (err) {
    logger.error({ err, schoolBotId: bot.id }, "school bot: token decrypt failed (BOT_TOKEN_ENCRYPTION_KEY wrong/missing?)");
    return null;
  }
}

export async function loadSchoolBotBySchool(schoolId: string): Promise<{ bot: SchoolBotRow; token: string } | null> {
  const [bot] = await db.select().from(schoolBotsTable).where(eq(schoolBotsTable.schoolId, schoolId)).limit(1);
  if (!bot) return null;
  const token = await getSchoolBotToken(bot);
  return token ? { bot, token } : null;
}

export async function loadSchoolBotById(botId: string): Promise<{ bot: SchoolBotRow; token: string } | null> {
  const [bot] = await db.select().from(schoolBotsTable).where(eq(schoolBotsTable.id, botId)).limit(1);
  if (!bot) return null;
  const token = await getSchoolBotToken(bot);
  return token ? { bot, token } : null;
}

/** آدرسِ پایهٔ سایت: PUBLIC_SITE_URL (بدونِ اسلشِ آخر)، وگرنه از هدرهایِ درخواست (فقط برایِ resyncِ دستی). */
export function siteBaseUrl(req?: { headers: Record<string, any>; protocol?: string }): string | null {
  const env = process.env.PUBLIC_SITE_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  if (req) {
    const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0].trim();
    const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol ?? "https").split(",")[0].trim();
    if (host) return `${proto}://${host}`;
  }
  return null;
}

export function schoolBotWebhookUrl(base: string, botId: string): string {
  return `${base.replace(/\/+$/, "")}/api/schools/bot-webhook/${botId}`;
}

export type SyncStep = { step: string; ok: boolean; detail?: string };

/** ثبتِ webhook (idempotent). همیشه با allowed_updates کامل. */
export async function registerSchoolBotWebhook(bot: SchoolBotRow, token: string, base: string | null): Promise<SyncStep> {
  if (!base) return { step: "webhook", ok: false, detail: "آدرسِ سایت (PUBLIC_SITE_URL) تنظیم نیست؛ تلگرام نمی‌داند پیام‌ها را کجا بفرستد." };
  if (!/^https:\/\//i.test(base)) return { step: "webhook", ok: false, detail: "تلگرام فقط به آدرسِ https پیام می‌فرستد؛ آدرسِ سایت https نیست." };
  const url = schoolBotWebhookUrl(base, bot.id);
  try {
    const r = await tgApi(token, "setWebhook", {
      url, secret_token: telegramWebhookSecret(token), allowed_updates: SCHOOL_BOT_ALLOWED_UPDATES, drop_pending_updates: false,
    });
    return r.ok ? { step: "webhook", ok: true, detail: url } : { step: "webhook", ok: false, detail: r.description ?? "setWebhook failed" };
  } catch (err) {
    logger.warn({ err, schoolBotId: bot.id }, "school bot: setWebhook threw");
    return { step: "webhook", ok: false, detail: "ارتباط با تلگرام برقرار نشد." };
  }
}

export type BotDiagnostics = {
  hasBot: boolean;
  username: string | null;
  tokenOk: boolean;
  webhookUrl: string | null;
  expectedWebhookUrl: string | null;
  webhookMatches: boolean;
  allowedUpdatesOk: boolean;
  pendingUpdates: number | null;
  lastErrorMessage: string | null;
  lastErrorDate: string | null;
  /** جمله‌هایِ فارسیِ ساده برایِ مدیر (خالی = سالم). */
  problems: string[];
};

/** getMe + getWebhookInfo → وضعیتِ قابلِ‌فهم. هرگز throw نمی‌کند. */
export async function getSchoolBotDiagnostics(schoolId: string, base: string | null): Promise<BotDiagnostics> {
  const d: BotDiagnostics = {
    hasBot: false, username: null, tokenOk: false, webhookUrl: null, expectedWebhookUrl: null, webhookMatches: false,
    allowedUpdatesOk: false, pendingUpdates: null, lastErrorMessage: null, lastErrorDate: null, problems: [],
  };
  const [bot] = await db.select().from(schoolBotsTable).where(eq(schoolBotsTable.schoolId, schoolId)).limit(1);
  if (!bot) { d.problems.push("این مدرسه هنوز بات ندارد."); return d; }
  d.hasBot = true;
  const token = await getSchoolBotToken(bot);
  if (!token) { d.problems.push("توکنِ بات خوانده نشد؛ لطفاً به پشتیبانی خبر دهید."); return d; }
  d.expectedWebhookUrl = base ? schoolBotWebhookUrl(base, bot.id) : null;
  try {
    const me = await tgApi<{ username?: string }>(token, "getMe");
    if (!me.ok) { d.problems.push("تلگرام توکنِ بات را نپذیرفت (باطل یا حذف شده)."); return d; }
    d.tokenOk = true;
    d.username = me.result?.username ?? bot.telegramUsername;
    const wi = await tgApi<{ url?: string; pending_update_count?: number; last_error_message?: string; last_error_date?: number; allowed_updates?: string[] }>(token, "getWebhookInfo");
    const r = wi.result ?? {};
    d.webhookUrl = r.url || null;
    d.pendingUpdates = r.pending_update_count ?? 0;
    d.lastErrorMessage = r.last_error_message ?? null;
    d.lastErrorDate = r.last_error_date ? new Date(r.last_error_date * 1000).toISOString() : null;
    d.webhookMatches = !!d.webhookUrl && d.webhookUrl === d.expectedWebhookUrl;
    // allowed_updates خالی/نامشخص یعنی پیش‌فرضِ تلگرام (بدونِ callback_query؟ پیش‌فرض همه‌چیز به‌جز چند مورد است) — آن را سالم می‌گیریم.
    d.allowedUpdatesOk = !r.allowed_updates?.length || SCHOOL_BOT_ALLOWED_UPDATES.every((u) => r.allowed_updates!.includes(u));
  } catch (err) {
    logger.warn({ err, schoolId }, "school bot diagnostics failed");
    d.problems.push("ارتباط با تلگرام برقرار نشد.");
    return d;
  }
  if (!base) d.problems.push("آدرسِ سایت (PUBLIC_SITE_URL) تنظیم نیست.");
  else if (!d.webhookUrl) d.problems.push("اتصالِ بات به سایت برقرار نیست (webhook ثبت نشده). دکمهٔ «اتصال بات / بروزرسانی بات» را بزنید.");
  else if (!d.webhookMatches) d.problems.push("بات به آدرسِ اشتباهی وصل است. دکمهٔ «اتصال بات / بروزرسانی بات» را بزنید.");
  if (!d.allowedUpdatesOk) d.problems.push("دکمه‌هایِ شیشه‌ای بات فعال نیست؛ دکمهٔ «اتصال بات / بروزرسانی بات» را بزنید.");
  if (d.lastErrorMessage) d.problems.push(`آخرین خطایِ تلگرام در رساندنِ پیام‌ها به سایت: ${d.lastErrorMessage}`);
  if ((d.pendingUpdates ?? 0) > 5) d.problems.push(`${d.pendingUpdates} پیامِ ارسالی به بات هنوز به سایت نرسیده است.`);
  return d;
}

/** ایدمپوتنت: برای همهٔ باتِ‌هایِ خریداری‌شده (حتی قبل از این تغییر). هنگامِ بوت — خطا نمی‌اندازد. */
export async function healAllSchoolBotWebhooks(): Promise<void> {
  try {
    const base = siteBaseUrl();
    if (!base) { logger.warn("school bots: PUBLIC_SITE_URL missing — webhooks cannot be (re)registered"); return; }
    const bots = await db.select().from(schoolBotsTable);
    for (const bot of bots) {
      try {
        const token = await getSchoolBotToken(bot);
        if (!token) continue;
        const wi = await tgApi<{ url?: string; allowed_updates?: string[] }>(token, "getWebhookInfo");
        const want = schoolBotWebhookUrl(base, bot.id);
        const upOk = !wi.result?.allowed_updates?.length || SCHOOL_BOT_ALLOWED_UPDATES.every((u) => wi.result!.allowed_updates!.includes(u));
        if (wi.result?.url === want && upOk) continue;
        const step = await registerSchoolBotWebhook(bot, token, base);
        logger.info({ schoolBotId: bot.id, ok: step.ok, was: wi.result?.url || null }, "school bot webhook self-heal");
        if (!bot.telegramUsername) await refreshIdentity(bot, token);
        await new Promise((r) => setTimeout(r, 100));
      } catch (err) {
        logger.warn({ err, schoolBotId: bot.id }, "school bot webhook self-heal failed (non-fatal)");
      }
    }
  } catch (err) {
    logger.warn({ err }, "healAllSchoolBotWebhooks failed (non-fatal)");
  }
}

export async function refreshIdentity(bot: SchoolBotRow, token: string): Promise<SyncStep> {
  try {
    const me = await tgApi<{ id: number; username?: string }>(token, "getMe");
    if (!me.ok || !me.result) return { step: "identity", ok: false, detail: me.description ?? "getMe failed" };
    await db.update(schoolBotsTable).set({ telegramUsername: me.result.username ?? bot.telegramUsername, telegramBotId: String(me.result.id) }).where(eq(schoolBotsTable.id, bot.id));
    return { step: "identity", ok: true, detail: me.result.username };
  } catch (err) {
    return { step: "identity", ok: false, detail: "ارتباط با تلگرام برقرار نشد." };
  }
}

export async function getSchoolName(schoolId: string): Promise<string | null> {
  const [s] = await db.select({ name: schoolsTable.name }).from(schoolsTable).where(eq(schoolsTable.id, schoolId)).limit(1);
  return s?.name ?? null;
}
