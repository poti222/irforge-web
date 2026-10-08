/**
 * lib/botLifetime.ts — «عمرِ» یک بات؛ ثابت‌ها و منطقِ خالصِ انقضا ⇒ حذف (بدونِ db، قابلِ تستِ مستقیم).
 * ─────────────────────────────────────────────────────────────────────────────
 * قاعده‌یِ محصولی (لایوباگ ۲۰۲۶-۱۰-۰۶: «بات‌ها وقتی زمانشان تمام می‌شود پاک نمی‌شوند؛ پرو و استاندارد اصلاً زمان
 * ندارند؛ تریال ۷ روز، استاندارد و پرو ۳۰ روز»):
 *
 *   - تریال ۷ روز، استاندارد/پرو ۳۰ روز (`TRIAL_DAYS` / `TIER_PERIOD_DAYS`).
 *   - با رسیدنِ تاریخ، سرویس قطع می‌شود (تریال: status "expired"؛ پکیج: اول تمدیدِ خودکار از کیف‌پول، وگرنه
 *     "tier_expired").
 *   - بعد از قطع، `PURGE_RETENTION_DAYS` (۷) روز مهلتِ تمدید است (هشدار در همان لحظه و ۳ روز مانده)، و بعد بات و
 *     دیتایش برای همیشه پاک می‌شود — همان تصمیمِ docs/DELETION_POLICY.md (روز ۰: هشدار، روز ۴: هشدارِ دوم، روز ۷: حذف).
 *   - باتی که از قبل مدت‌ها پیش منقضی شده، به‌جایِ حذفِ ناگهانی، همین ۷ روز را از لحظه‌یِ اولین دیده‌شدن می‌گیرد.
 */
export const TRIAL_DAYS = 7;
export const TIER_PERIOD_DAYS = 30;
export const PURGE_RETENTION_DAYS = 7;
/** هشدارِ دوم: وقتی این‌قدر روز تا حذف مانده. */
export const PURGE_FINAL_WARNING_DAYS = 3;

export const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** پایانِ یک دوره‌یِ پکیجِ استاندارد/پرو: دقیقاً ۳۰ روز بعد (نه «یک ماهِ تقویمی»). */
export function addTierPeriod(date: Date): Date {
  return addDays(date, TIER_PERIOD_DAYS);
}

export function trialEndDate(from: Date = new Date()): Date {
  return addDays(from, TRIAL_DAYS);
}

type BotLike = {
  isTrial?: boolean | null;
  trialExpiresAt?: Date | null;
  tier?: string | null;
  tierExpiresAt?: Date | null;
  status?: string | null;
};

export type BotExpiry = { kind: "trial" | "tier"; expiredAt: Date };

/**
 * آیا این بات «منقضی» است (یعنی سرویسش قطع شده و حذفش در راه است)؟
 *  - تریال: تاریخ گذشته باشد.
 *  - استاندارد/پرو: تاریخ گذشته **و** تمدیدِ خودکار شکست خورده باشد (status = "tier_expired") — تا باتی که جاروی
 *    تمدید هنوز به آن نرسیده هرگز اشتباهی حذف نشود.
 *  - سفارشی/بی‌پکیج: هرگز.
 */
/**
 * «پکیجِ ماهانه» = هر محصولِ دسته‌ی بات (standard/pro یا هر پلنی که ادمین بعداً بسازد). سفارشی و تریال از این مفهوم مستثنا
 * هستند. قبلاً فقط دو literal بود؛ پلنِ تازه‌ی ادمین هرگز انقضا/تمدید/حذفِ خودکار نمی‌گرفت.
 */
export function isPackageTier(tier: string | null | undefined): boolean {
  return !!tier && tier !== "custom" && tier !== "trial";
}

export function botExpiry(bot: BotLike, now: Date = new Date()): BotExpiry | null {
  if (bot.isTrial && bot.trialExpiresAt) {
    return bot.trialExpiresAt.getTime() <= now.getTime() ? { kind: "trial", expiredAt: bot.trialExpiresAt } : null;
  }
  if (isPackageTier(bot.tier) && bot.tierExpiresAt) {
    if (bot.tierExpiresAt.getTime() <= now.getTime() && bot.status === "tier_expired") {
      return { kind: "tier", expiredAt: bot.tierExpiresAt };
    }
  }
  return null;
}

/** زمانِ حذف: `max(تاریخِ انقضا, الان) + ۷ روز` — باتِ خیلی‌قدیمیِ منقضی هم ۷ روزِ کاملِ مهلت می‌گیرد. */
export function computePurgeAfter(expiredAt: Date, now: Date = new Date()): Date {
  return addDays(new Date(Math.max(expiredAt.getTime(), now.getTime())), PURGE_RETENTION_DAYS);
}

export type PurgeStage = "delete" | "final_warning" | "first_warning";

export function purgeStage(purgeAfter: Date, now: Date = new Date()): PurgeStage {
  const left = purgeAfter.getTime() - now.getTime();
  if (left <= 0) return "delete";
  if (left <= PURGE_FINAL_WARNING_DAYS * DAY_MS) return "final_warning";
  return "first_warning";
}

export function purgeDaysLeft(purgeAfter: Date, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((purgeAfter.getTime() - now.getTime()) / DAY_MS));
}
