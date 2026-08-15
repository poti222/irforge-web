/**
 * lib/botStats.ts — آمار واقعی کاربران یک بات.
 * ─────────────────────────────────────────────────────────────────────────────
 * تا امروز `GET /bots/:botId/stats` عدد کاربران را از ستون `bots.user_count`
 * در Postgres می‌خواند — ستونی که هیچ‌کس به‌روزش نمی‌کرد — و «کاربران فعال
 * امروز» اصلاً محاسبه نمی‌شد، برای همین UI به‌جای عدد یک خط تیره نشان می‌داد
 * (کامنت `TODO: backend field` در `BotStatsPanel.tsx` خودش اعتراف به همین بود).
 *
 * منبع درست همان جایی است که خودِ بات می‌نویسد: تب `users` روی شیت تننت، که
 * برای هر کاربر `last_seen` دارد. اینجا از روی همان، سه عدد ساخته می‌شود:
 *   - کل کاربران
 *   - کاربران فعال امروز (به وقت تهران — نه UTC، نه ساعت سرور)
 *   - سری ۷ روزه‌ی کاربران فعال برای نمودار
 *
 * **کش سمت سرور.** پنل آمار هر ۵ ثانیه poll می‌کند و این تب می‌تواند هزاران
 * ردیف داشته باشد؛ بدون کش، هر بات باز در یک تب مرورگر معادل ۱۲ فراخوانی در
 * دقیقه به Google Sheets است و سهمیه‌ی خواندن را می‌سوزاند. یک کش ۶۰ ثانیه‌ای
 * درون‌پروسسی — هم‌اندازه‌ی `CACHE_TTL` خودِ بات — این را به ۱ فراخوانی در
 * دقیقه می‌رساند بدون اینکه عددها به‌شکل محسوسی کهنه شوند.
 */
import { listEntity } from "./botConfig.js";
import { tehranDayKey, tehranToday, tehranLastDays } from "./tehranTime.js";
import { logger } from "./logger.js";
import type { BotUser } from "./botTypes.js";

const USERS_TAB = "users";
const TTL_MS = 60_000;
const DAYS_IN_CHART = 7;

export type BotUserStats = {
  users: number;
  activeUsersToday: number;
  activeUsersPerDay: Array<{ date: string; count: number }>;
};

const cache = new Map<string, { at: number; stats: BotUserStats }>();

/** کشِ یک بات را باطل می‌کند — بعد از هر نوشتنی روی تب کاربران. */
export function invalidateBotStats(spreadsheetId: string): void {
  cache.delete(spreadsheetId);
}

function emptyStats(): BotUserStats {
  return {
    users: 0,
    activeUsersToday: 0,
    activeUsersPerDay: tehranLastDays(DAYS_IN_CHART).map((date) => ({ date, count: 0 })),
  };
}

function compute(users: BotUser[]): BotUserStats {
  const today = tehranToday();
  const days = tehranLastDays(DAYS_IN_CHART);
  const counts = new Map<string, number>(days.map((d) => [d, 0]));

  let activeToday = 0;
  for (const user of users) {
    // `last_seen` را خودِ بات می‌نویسد و ممکن است خالی یا بدشکل باشد
    // (کاربری که از قبل از افزوده‌شدن این فیلد مانده). چنین ردیفی در شمارشِ
    // «کل کاربران» هست ولی در هیچ روزی فعال حساب نمی‌شود.
    const raw = String(user.last_seen ?? "").trim();
    if (!raw) continue;
    const day = tehranDayKey(raw);
    if (!day) continue;
    if (day === today) activeToday += 1;
    if (counts.has(day)) counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  return {
    users: users.length,
    activeUsersToday: activeToday,
    activeUsersPerDay: days.map((date) => ({ date, count: counts.get(date) ?? 0 })),
  };
}

/**
 * آمار کاربران یک بات. **هرگز throw نمی‌کند**: اگر تب کاربران خوانده نشد،
 * صفرها برمی‌گردند — یک کارت آمار نباید کل صفحه‌ی نمای کلی را قرمز کند.
 */
export async function botUserStats(spreadsheetId: string): Promise<BotUserStats> {
  const cached = cache.get(spreadsheetId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.stats;

  try {
    const rows = await listEntity<BotUser>(spreadsheetId, USERS_TAB);
    const users = rows
      .filter((r) => r.value && typeof r.value === "object")
      .map((r) => r.value as BotUser);
    const stats = compute(users);
    cache.set(spreadsheetId, { at: Date.now(), stats });
    return stats;
  } catch (err) {
    logger.warn({ err, spreadsheetId }, "botUserStats failed — returning zeros");
    return emptyStats();
  }
}

/** فقط برای تست. */
export const __testables = { compute, emptyStats };
