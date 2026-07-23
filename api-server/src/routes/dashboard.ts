import { logger } from "../lib/logger";
import { Router } from "express";
import { db, botsTable, usersTable, activityTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";
import { requireAuth } from "./auth";

const router = Router();

// GET /api/dashboard/stats
router.get("/dashboard/stats", requireAuth, async (req: any, res) => {
  try {
    const bots = await db.select().from(botsTable).where(eq(botsTable.userId, req.userId));
    const activeBots = bots.filter(b => b.status === "active").length;
    const totalUsers = bots.reduce((acc, b) => acc + b.userCount, 0);
    const totalMessages = bots.reduce((acc, b) => acc + b.messageCount, 0);

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
      totalRevenue: 0,
      botsChange: pctChange(bots.length, priorBots.length),
      usersChange: pctChange(totalUsers, priorUsers),
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
