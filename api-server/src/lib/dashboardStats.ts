/**
 * lib/dashboardStats.ts — اعدادِ داشبورد، از منبع واقعی.
 * ─────────────────────────────────────────────────────────────────────────────
 * دو کارت داشبورد سال‌ها عددِ مرده نشان می‌دادند:
 *
 *   - **«پیام‌های پردازش‌شده»** از `bots.message_count` می‌آمد. جستجوی کل دو
 *     مخزن نشان داد **هیچ‌جا این ستون نوشته نمی‌شود** — نه بات، نه سایت. پس
 *     برای همه‌ی کاربران همیشه صفر بوده. (پرامپت فرض کرده بود نوشتنِ
 *     به‌ازای هر پیام گران است و باید batch شود؛ مسئله این نبود — اصلاً
 *     نوشتنی وجود ندارد.)
 *   - **«درآمد»** به‌صورت `totalRevenue: 0` هاردکد شده بود.
 *
 * این ماژول هر دو را با داده‌ی واقعی جایگزین می‌کند: «کاربران فعال امروز»
 * از `last_seen` تب کاربران، و درآمد از سفارش‌های **تأییدشده‌ی** تب
 * `payments` — همان جایی که خود بات می‌نویسد.
 *
 * **هزینه.** این‌ها از Google Sheets می‌آیند و داشبورد صفحه‌ی اولِ هر ورود
 * است. پس: فقط باتِ فعال خوانده می‌شود، درآمد فقط برای باتی که پلاگین کیف
 * پول دارد، و نتیجه ۵ دقیقه کش می‌شود. بدون این‌ها، هر رفرش داشبورد یک
 * خواندن به‌ازای هر بات بود.
 */
import { listEntity } from "./botConfig.js";
import { isPluginEnabled } from "./pluginGate.js";
import { botUserStats } from "./botStats.js";
import { logger } from "./logger.js";

const TTL_MS = 5 * 60_000;
/** سقف باتی که برای یک داشبورد خوانده می‌شود — جلوی کاربری با ۵۰ بات را می‌گیرد. */
const MAX_BOTS = 12;

type Cached = { at: number; value: DashboardExtras };
const cache = new Map<string, Cached>();

export type DashboardExtras = {
  /**
   * مجموع کاربران همه‌ی بات‌ها، از تب `users` هر شیت.
   *
   * `null` یعنی هیچ باتی خوانده نشد (بات فعالی نبود، یا خواندن شکست خورد) —
   * در آن حالت صداکننده به عدد Postgres برمی‌گردد به‌جای اینکه صفر نشان دهد.
   *
   * چرا لازم شد: داشبورد `bots.user_count` را جمع می‌زد، ستونی که هیچ‌جای
   * این استک نوشته نمی‌شود. صفحه‌ی بات‌ها مدت‌هاست عدد زنده را نشان می‌دهد
   * (`routes/bots.ts`)، ولی داشبورد جا مانده بود و همیشه صفر بود.
   */
  totalUsers: number | null;
  /** مجموع کاربرانی که امروز (به وقت تهران) با باتی از این کاربر کار کرده‌اند. */
  activeUsersToday: number;
  /**
   * مجموع مبلغ سفارش‌های تأییدشده. `null` یعنی هیچ باتی پلاگین کیف پول
   * ندارد — کارت درآمد اصلاً نباید نشان داده شود، نه اینکه صفر نشان دهد.
   */
  revenue: number | null;
};

/** مجموع مبلغ سفارش‌های `verified` یک بات. هرگز throw نمی‌کند. */
async function verifiedRevenue(spreadsheetId: string): Promise<number> {
  try {
    const rows = await listEntity<{ status?: string; amount?: unknown }>(spreadsheetId, "payments");
    let sum = 0;
    for (const row of rows) {
      const order = row.value;
      if (!order || typeof order !== "object") continue;
      if (order.status !== "verified") continue;
      const amount = Number(order.amount);
      if (Number.isFinite(amount)) sum += amount;
    }
    return sum;
  } catch (err) {
    logger.debug({ err, spreadsheetId }, "verifiedRevenue failed; counting zero for this bot");
    return 0;
  }
}

/**
 * اعداد داشبورد برای یک کاربر.
 *
 * **هرگز throw نمی‌کند**: داشبورد نباید به‌خاطر یک خطای موقت گوگل‌شیت قرمز
 * شود. در بدترین حالت صفر و `null` برمی‌گردد و کارت‌ها همان را نشان می‌دهند.
 */
export async function dashboardExtras(
  userId: string,
  bots: Array<{ id: string; sheetId: string | null; status: string }>,
): Promise<DashboardExtras> {
  const cached = cache.get(userId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const value: DashboardExtras = { totalUsers: null, activeUsersToday: 0, revenue: null };

  try {
    // «کاربران فعال امروز» فقط برای باتِ روشن معنی دارد، ولی **کل کاربران**
    // برای بات خاموش هم واقعی است — کاربرانش که پاک نشده‌اند. پس شمارش کل
    // روی همه‌ی باتِ دارای شیت انجام می‌شود، نه فقط فعال‌ها.
    const targets = bots.filter((b) => b.sheetId).slice(0, MAX_BOTS);

    for (const bot of targets) {
      const sheetId = bot.sheetId as string;
      const active = bot.status === "active";

      const stats = await botUserStats(sheetId);
      value.totalUsers = (value.totalUsers ?? 0) + stats.users;
      if (active) value.activeUsersToday += stats.activeUsersToday;
      if (!active) continue;

      // درآمد فقط برای باتی که واقعاً فروش دارد.
      if (await isPluginEnabled(sheetId, "wallet")) {
        value.revenue = (value.revenue ?? 0) + (await verifiedRevenue(sheetId));
      }
    }
  } catch (err) {
    logger.warn({ err, userId }, "dashboardExtras failed; returning what we have");
  }

  cache.set(userId, { at: Date.now(), value });
  return value;
}

/** برای تست. */
export const __testables = { verifiedRevenue };
