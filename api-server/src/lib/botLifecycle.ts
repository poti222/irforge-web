/**
 * lib/botLifecycle.ts — جاروی «انقضا ⇒ حذفِ نهایی» (هر ۱۰ دقیقه از index.ts).
 * ─────────────────────────────────────────────────────────────────────────────
 * قاعده و عددها در lib/botLifetime.ts. این فایل فقط اجرا می‌کند:
 *
 *   ۰. خودترمیمی: باتِ استاندارد/پرو که تاریخِ پایان ندارد (خریدِ قدیمی / ستِ دستی) ۳۰ روز از همین لحظه می‌گیرد.
 *   ۱. تریال‌ها را (به‌جایِ فقط lazy) ارزیابی می‌کند: هشدارِ ۳/۲/۱ روز، و قطعِ سرویس در لحظه‌یِ پایان.
 *   ۲. باتِ منقضی (تریال گذشته، یا پکیجی که تمدیدِ خودکارش شکست خورده) → `purge_after` ثبت می‌شود، هشدارِ «۷ روز تا حذف»،
 *      بعد «۳ روز تا حذف»، و در لحظه‌یِ `purge_after` حذفِ کامل (`purgeBotFully` — همان منطقِ حذفِ دستیِ کاربر).
 *   ۳. باتی که تمدید/ارتقا شد (دیگر منقضی نیست) `purge_after`ش پاک می‌شود.
 *
 * هرگز throw نمی‌کند؛ خطای یک بات لاگ و رد می‌شود. سقفِ حذف در هر دور (`MAX_PURGES_PER_SWEEP`) تا یک باگِ احتمالی
 * هرگز ده‌ها بات را یک‌جا نبرد.
 */
import { db, botsTable } from "@workspace/db";
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { logger } from "./logger.js";
import { createNotification } from "./notify.js";
import { evaluateBotTrial } from "./trial.js";
import { purgeBotFully } from "./botPurge.js";
import { writeAudit } from "./audit.js";
import {
  addTierPeriod, botExpiry, computePurgeAfter, purgeDaysLeft, purgeStage, PURGE_FINAL_WARNING_DAYS, PURGE_RETENTION_DAYS,
  TIER_PERIOD_DAYS,
} from "./botLifetime.js";

type BotRow = typeof botsTable.$inferSelect;

export const MAX_PURGES_PER_SWEEP = 25;

const day = (d: Date) => d.toISOString().slice(0, 10);

/** استاندارد/پرو بدونِ تاریخِ پایان ⇒ ۳۰ روز از الان. */
async function ensureTierExpiry(): Promise<void> {
  const rows = await db.select().from(botsTable).where(and(
    inArray(botsTable.tier, ["standard", "pro"]),
    isNull(botsTable.tierExpiresAt),
    eq(botsTable.isTrial, false),
  ));
  for (const bot of rows) {
    const expiry = addTierPeriod(new Date());
    const [updated] = await db.update(botsTable).set({ tierExpiresAt: expiry })
      .where(and(eq(botsTable.id, bot.id), isNull(botsTable.tierExpiresAt))).returning({ id: botsTable.id });
    if (!updated) continue;
    await createNotification({
      userId: bot.userId,
      botId: bot.id,
      type: "tier_period_started",
      severity: "info",
      title: "مدتِ اعتبارِ پکیجِ بات مشخص شد",
      message: `پکیجِ «${bot.tier === "pro" ? "پرو" : "استاندارد"}» بات «${bot.name}» ${TIER_PERIOD_DAYS} روز اعتبار دارد و تا ${day(expiry)} تمدید می‌شود (از کیف پول، یا دستی از صفحه‌یِ بات).`,
      dedupeKey: `tier-period-start:${bot.id}`,
    });
  }
}

async function warnPurge(bot: BotRow, purgeAfter: Date, stage: "first_warning" | "final_warning"): Promise<void> {
  const left = purgeDaysLeft(purgeAfter);
  const kind = bot.isTrial ? "تریالِ" : "پکیجِ";
  await createNotification({
    userId: bot.userId,
    botId: bot.id,
    type: "bot_purge_warning",
    severity: stage === "final_warning" ? "critical" : "warning",
    title: `${left} روز تا حذفِ دائمیِ بات «${bot.name}»`,
    message:
      `${kind} بات «${bot.name}» تمام شده و سرویسش قطع است. اگر تا ${day(purgeAfter)} ` +
      `(${left} روز دیگر) ${bot.isTrial ? "یک پکیج بخرید" : "پکیج را تمدید کنید"}، بات و همه‌یِ داده‌هایش برای همیشه پاک می‌شود و بازگشت‌پذیر نیست.`,
    dedupeKey: `bot-purge-${stage}:${bot.id}:${day(purgeAfter)}`,
  });
}

/** یک بات را (اگر لازم بود) به مرحله‌یِ بعدِ چرخه‌یِ عمر می‌برد. true = این بات همین الان حذف شد. */
async function advanceBot(initial: BotRow, now: Date): Promise<boolean> {
  let bot = initial;
  if (bot.isTrial && bot.trialExpiresAt) bot = await evaluateBotTrial(bot); // هشدار/قطعِ سرویس

  const expiry = botExpiry(bot, now);
  if (!expiry) {
    // تمدید/ارتقا/تمدیدِ دستیِ تاریخ ⇒ دیگر منقضی نیست؛ شمارشِ معکوسِ حذف باید پاک شود.
    if (bot.purgeAfter) await db.update(botsTable).set({ purgeAfter: null }).where(eq(botsTable.id, bot.id));
    return false;
  }

  let purgeAfter = bot.purgeAfter;
  if (!purgeAfter) {
    purgeAfter = computePurgeAfter(expiry.expiredAt, now);
    await db.update(botsTable).set({ purgeAfter }).where(and(eq(botsTable.id, bot.id), isNull(botsTable.purgeAfter)));
  }

  const stage = purgeStage(purgeAfter, now);
  if (stage !== "delete") {
    await warnPurge(bot, purgeAfter, stage);
    return false;
  }

  // دوباره از db بخوان: بین انتخابِ دسته و همین لحظه ممکن است مالک تمدید کرده باشد (race).
  const [fresh] = await db.select().from(botsTable).where(eq(botsTable.id, bot.id)).limit(1);
  if (!fresh) return false;
  const freshExpiry = botExpiry(fresh, now);
  if (!freshExpiry || !fresh.purgeAfter || fresh.purgeAfter.getTime() > now.getTime()) return false;

  await purgeBotFully(fresh, "expiry");
  await writeAudit({
    actorUserId: "system:expiry",
    action: "bot_purged",
    targetUserId: fresh.userId,
    reason: "expiry",
    metadata: { botId: fresh.id, botName: fresh.name, kind: freshExpiry.kind, expiredAt: freshExpiry.expiredAt.toISOString() },
  });
  await createNotification({
    userId: fresh.userId,
    botId: null,
    type: "bot_purged",
    severity: "critical",
    title: `بات «${fresh.name}» حذف شد`,
    message: `مهلتِ ${PURGE_RETENTION_DAYS} روزه‌یِ بعد از پایانِ ${freshExpiry.kind === "trial" ? "تریال" : "پکیج"} تمام شد و بات «${fresh.name}» همراه با داده‌هایش برای همیشه حذف شد.`,
    dedupeKey: `bot-purged:${fresh.id}`,
  });
  logger.warn({ botId: fresh.id, userId: fresh.userId, kind: freshExpiry.kind }, "bot purged after expiry retention window");
  return true;
}

/** یک دورِ جارو — هرگز throw نمی‌کند. */
export async function sweepBotLifecycle(): Promise<{ purged: number }> {
  try {
    await ensureTierExpiry();
  } catch (err) {
    logger.error({ err }, "sweepBotLifecycle: ensureTierExpiry failed");
  }

  let candidates: BotRow[];
  try {
    candidates = await db.select().from(botsTable).where(or(
      eq(botsTable.isTrial, true),
      inArray(botsTable.tier, ["standard", "pro"]),
      isNotNull(botsTable.purgeAfter),
    ));
  } catch (err) {
    logger.error({ err }, "sweepBotLifecycle: failed to load bots");
    return { purged: 0 };
  }

  const now = new Date();
  let purged = 0;
  for (const bot of candidates) {
    if (purged >= MAX_PURGES_PER_SWEEP) {
      logger.warn({ max: MAX_PURGES_PER_SWEEP }, "sweepBotLifecycle: purge cap reached, remaining bots wait for the next pass");
      break;
    }
    try {
      if (await advanceBot(bot, now)) purged += 1;
    } catch (err) {
      logger.error({ err, botId: bot.id }, "sweepBotLifecycle: per-bot failure (skipped)");
    }
  }
  return { purged };
}

export const __testables = { PURGE_FINAL_WARNING_DAYS };
