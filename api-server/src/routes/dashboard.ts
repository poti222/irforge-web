import { logger } from "../lib/logger";
import { Router } from "express";
import { db, botsTable, usersTable, activityTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";
import { requireAuth } from "./auth";
import { dashboardExtras } from "../lib/dashboardStats";

const router = Router();

// GET /api/dashboard/stats
router.get("/dashboard/stats", requireAuth, async (req: any, res) => {
  try {
    const bots = await db.select().from(botsTable).where(eq(botsTable.userId, req.userId));
    const activeBots = bots.filter(b => b.status === "active").length;
    // ⚠️ `bots.user_count` در Postgres مرده است — هیچ‌جای این استک نوشته
    // نمی‌شود. عدد واقعی از تب `users` هر شیت می‌آید (همان منبعی که صفحه‌ی
    // بات‌ها استفاده می‌کند). این جمعِ Postgres فقط وقتی می‌ماند که هیچ شیتی
    // خوانده نشد، تا داشبورد به‌جای عدد، صفر نشان ندهد.
    const fallbackUsers = bots.reduce((acc, b) => acc + b.userCount, 0);
    // ⚠️ `bots.message_count` هیچ‌جای این استک نوشته نمی‌شود — نه بات، نه
    // سایت — پس همیشه صفر است. به‌جایش «کاربران فعال امروز» از داده‌ی واقعیِ
    // شیت می‌آید (lib/dashboardStats.ts). این کلید فقط برای کلاینت‌های قدیمی
    // در پاسخ می‌ماند.
    const totalMessages = bots.reduce((acc, b) => acc + b.messageCount, 0);
    const extras = await dashboardExtras(req.userId, bots);
    const totalUsers = extras.totalUsers ?? fallbackUsers;

    // P5: real period-over-period deltas instead of the previous constant
    // fake values. There are no historical snapshots of userCount/messageCount,
    // so we derive a real (non-constant) change from the bot cohort: compare the
    // metric across all bots against only the bots that already existed 30 days
    // ago (by createdAt). This reflects growth contributed by recently onboarded
    // bots rather than a hardcoded number.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const priorBots = bots.filter(b => b.createdAt <= cutoff);
    const priorUsers = priorBots.reduce((acc, b) => acc + b.userCount, 0);
    const priorMessages = priorBots.reduce((acc, b) => acc + b.messageCount, 0);

    const pctChange = (current: number, prior: number): number => {
      if (prior === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - prior) / prior) * 1000) / 10; // one decimal
    };

    res.json({
      totalBots: bots.length,
      activeBots,
      totalUsers,
      totalMessages,
      activeUsersToday: extras.activeUsersToday,
      // `null` یعنی هیچ باتی پلاگین کیف پول ندارد → کارت درآمد اصلاً نباید
      // نمایش داده شود. قبلاً همیشه صفرِ هاردکد بود.
      totalRevenue: extras.revenue,
      botsChange: pctChange(bots.length, priorBots.length),
      // `null` یعنی «قابل محاسبه نیست»، نه صفر.
      //
      // درصد رشد کاربران از مقایسه‌ی «همه‌ی بات‌ها» با «بات‌های قدیمی‌تر از ۳۰
      // روز» می‌آمد، ولی هر دو طرفِ آن از `bots.user_count` خوانده می‌شدند —
      // ستونی که همیشه صفر است. یعنی مخرج همیشه صفر بود و کارت برای هر
      // کاربری «۱۰۰٪+» نشان می‌داد. عدد کل حالا زنده است ولی تاریخچه‌ای وجود
      // ندارد که با آن مقایسه شود، پس چیزی ادعا نمی‌کنیم.
      usersChange: extras.totalUsers === null ? pctChange(totalUsers, priorUsers) : null,
      messagesChange: pctChange(totalMessages, priorMessages),
    });
  } catch (err) {
    logger.error({ err }, "Dashboard stats error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/dashboard/activity
router.get("/dashboard/activity", requireAuth, async (req: any, res) => {
  try {
    const items = await db.select().from(activityTable)
      .where(eq(activityTable.userId, req.userId))
      .orderBy(desc(activityTable.createdAt))
      .limit(20);
    res.json(items.map(item => ({
      id: item.id,
      type: item.type,
      title: item.title,
      description: item.description,
      botName: item.botName,
      createdAt: item.createdAt.toISOString(),
    })));
  } catch (err) {
    logger.error({ err }, "Dashboard activity error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
