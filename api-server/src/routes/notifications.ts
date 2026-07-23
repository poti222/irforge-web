/**
 * routes/notifications.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * سیستم اعلان‌های جدید سایت. اولین مصرف‌کننده: هشدارهای تریال ۷ روزه.
 * چون سرور cron ندارد، هر GET ابتدا evaluateUserTrials را صدا می‌زند تا اگر
 * لازم بود اعلان جدید (هشدار/پایان تریال) همین حالا ساخته شود.
 */
import { Router } from "express";
import { db, notificationsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "./auth";
import { evaluateUserTrials } from "../lib/trial";
import { logger } from "../lib/logger";

const router = Router();

// GET /api/notifications
router.get("/notifications", requireAuth, async (req: any, res) => {
  try {
    await evaluateUserTrials(req.userId);

    const rows = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, req.userId))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(50);

    res.json(
      rows.map((n) => ({
        id: n.id,
        botId: n.botId,
        type: n.type,
        severity: n.severity,
        title: n.title,
        message: n.message,
        read: n.read,
        createdAt: n.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    logger.error({ err }, "List notifications error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/notifications/:id/read
router.patch("/notifications/:id/read", requireAuth, async (req: any, res) => {
  try {
    const [row] = await db
      .select({ id: notificationsTable.id, userId: notificationsTable.userId })
      .from(notificationsTable)
      .where(eq(notificationsTable.id, req.params.id))
      .limit(1);
    if (!row || row.userId !== req.userId) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await db
      .update(notificationsTable)
      .set({ read: true })
      .where(eq(notificationsTable.id, req.params.id));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Mark notification read error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/notifications/read-all
router.post("/notifications/read-all", requireAuth, async (req: any, res) => {
  try {
    await db
      .update(notificationsTable)
      .set({ read: true })
      .where(and(eq(notificationsTable.userId, req.userId), eq(notificationsTable.read, false)));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Mark all notifications read error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
