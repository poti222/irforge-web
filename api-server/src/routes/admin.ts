import { logger } from "../lib/logger";
import { Router } from "express";
import { db, usersTable, botsTable, announcementsTable, userPlansTable, plansTable } from "@workspace/db";
import { eq, and, gte, sql, desc } from "drizzle-orm";
import crypto from "crypto";
import { requireAdmin, requireAuth } from "./auth";
import { syncUserUpsert, syncUserDelete } from "../lib/sheetsSync";
import { createNotificationsBulk, severityForAnnouncementType } from "../lib/notify";

const router = Router();

// GET /api/announcements — R5b: tenant-facing list so announcements created in
// the admin panel are actually visible on the user dashboard (requireAuth, not
// requireAdmin, since every signed-in user should see platform notices).
router.get("/announcements", requireAuth, async (req: any, res) => {
  try {
    const items = await db
      .select()
      .from(announcementsTable)
      .orderBy(desc(announcementsTable.createdAt));
    res.json(items.map(a => ({
      id: a.id,
      title: a.title,
      message: a.message,
      type: a.type,
      createdAt: a.createdAt.toISOString(),
    })));
  } catch (err) {
    logger.error({ err }, "List public announcements error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/users
router.get("/admin/users", requireAdmin, async (req: any, res) => {
  try {
    const users = await db.select().from(usersTable);
    const usersWithBotCount = await Promise.all(users.map(async (u) => {
      const bots = await db.select().from(botsTable).where(eq(botsTable.userId, u.id));
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        avatar: u.avatar,
        role: u.role,
        plan: u.plan,
        status: u.status,
        botCount: bots.length,
        lastLogin: u.lastLogin?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
      };
    }));
    res.json(usersWithBotCount);
  } catch (err) {
    logger.error({ err }, "Admin list users error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/admin/users/:userId
router.patch("/admin/users/:userId", requireAdmin, async (req: any, res) => {
  try {
    // FIX [Critical]: prevent admin from modifying their own account
    if (req.params.userId === req.userId) {
      res.status(400).json({ error: "Admin cannot modify their own account" });
      return;
    }
    const { role, status, plan } = req.body;
    // FIX [X3]: requireAdmin lets both `admin` and `super_admin` through, but
    // granting the `super_admin` role must be reserved for existing super_admins.
    // Otherwise a plain admin could self-escalate the platform via any account,
    // bypassing the env-secret-gated /auth/super-admin-code flow.
    if (role === "super_admin") {
      const [requester] = await db
        .select({ role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.id, req.userId))
        .limit(1);
      if (!requester || requester.role !== "super_admin") {
        res.status(403).json({ error: "Only a super admin can grant the super_admin role" });
        return;
      }
    }
    const update: Record<string, any> = {};
    if (role !== undefined) update.role = role;
    if (status !== undefined) update.status = status;
    if (plan !== undefined) update.plan = plan;
    const [user] = await db.update(usersTable).set(update)
      .where(eq(usersTable.id, req.params.userId))
      .returning();
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const bots = await db.select().from(botsTable).where(eq(botsTable.userId, user.id));
    syncUserUpsert({ id: user.id, name: user.name, email: user.email, role: user.role, plan: user.plan, status: user.status, bio: user.bio, telegramUsername: user.telegramUsername, createdAt: user.createdAt, updatedAt: user.updatedAt });
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      role: user.role,
      plan: user.plan,
      status: user.status,
      botCount: bots.length,
      lastLogin: user.lastLogin?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Admin update user error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/admin/users/:userId
router.delete("/admin/users/:userId", requireAdmin, async (req: any, res) => {
  try {
    // FIX [Critical]: prevent admin from deleting their own account
    if (req.params.userId === req.userId) {
      res.status(400).json({ error: "Admin cannot delete their own account" });
      return;
    }
    await db.delete(usersTable).where(eq(usersTable.id, req.params.userId));
    syncUserDelete(req.params.userId);
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Admin delete user error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/stats
router.get("/admin/stats", requireAdmin, async (req: any, res) => {
  try {
    const users = await db.select().from(usersTable);
    const bots = await db.select().from(botsTable);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newUsersToday = users.filter(u => u.createdAt >= today).length;
    const totalMessages = bots.reduce((acc, b) => acc + b.messageCount, 0);

    const planBreakdown = ["free", "starter", "pro", "enterprise"].map(plan => ({
      plan,
      count: users.filter(u => u.plan === plan).length,
    }));

    // FIX [Important]: calculate real revenue from userPlans joined with plans
    const userPlans = await db
      .select({ price: plansTable.price, createdAt: userPlansTable.createdAt })
      .from(userPlansTable)
      .innerJoin(plansTable, eq(userPlansTable.planId, plansTable.id))
      .where(eq(userPlansTable.status, "active"));

    const totalRevenue = userPlans.reduce((acc, up) => acc + (up.price ?? 0), 0);

    // Real revenue grouped by month (last 6 months)
    const now = new Date();
    const revenueByMonth = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const nextMonth = new Date(now.getFullYear(), now.getMonth() - (5 - i) + 1, 1);
      const monthRevenue = userPlans
        .filter(up => up.createdAt >= d && up.createdAt < nextMonth)
        .reduce((acc, up) => acc + (up.price ?? 0), 0);
      return {
        month: d.toLocaleString("default", { month: "short" }),
        revenue: monthRevenue,
      };
    });

    res.json({
      totalUsers: users.length,
      totalBots: bots.length,
      totalRevenue,
      activeUsers: users.filter(u => u.status === "active").length,
      newUsersToday,
      totalMessages,
      revenueByMonth,
      planBreakdown,
    });
  } catch (err) {
    logger.error({ err }, "Admin stats error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** Allowed values of `announcements.type` — mirrors AnnouncementInputType in the OpenAPI spec. */
const ANNOUNCEMENT_TYPES = ["info", "warning", "success", "error"] as const;
const ANNOUNCEMENT_TITLE_MAX = 200;
const ANNOUNCEMENT_MESSAGE_MAX = 4000;

// GET /api/admin/announcements
// FIX: this listing had no ORDER BY, so Postgres returned rows in whatever
// order it pleased — a freshly published announcement could land anywhere in
// the list, which reads as "publishing did nothing". Ordered newest-first, to
// match the tenant-facing GET /api/announcements above.
router.get("/admin/announcements", requireAdmin, async (req: any, res) => {
  try {
    const items = await db
      .select()
      .from(announcementsTable)
      .orderBy(desc(announcementsTable.createdAt));
    res.json(items.map(a => ({
      id: a.id,
      title: a.title,
      message: a.message,
      type: a.type,
      createdAt: a.createdAt.toISOString(),
    })));
  } catch (err) {
    logger.error({ err }, "List announcements error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/announcements
router.post("/admin/announcements", requireAdmin, async (req: any, res) => {
  try {
    // FIX: title/message/type went into the insert straight from req.body with
    // no validation. A missing `message` hit the NOT NULL constraint and came
    // back as an opaque 500; a whitespace-only title, a 5000-character title, a
    // numeric title and a `type` outside the allowed set were all accepted and
    // persisted. Validate up front and answer 400 with a message the admin
    // panel can show.
    const { title, message, type } = req.body ?? {};

    if (typeof title !== "string" || title.trim() === "") {
      res.status(400).json({ error: "Title is required" });
      return;
    }
    if (typeof message !== "string" || message.trim() === "") {
      res.status(400).json({ error: "Message is required" });
      return;
    }
    const trimmedTitle = title.trim();
    const trimmedMessage = message.trim();
    if (trimmedTitle.length > ANNOUNCEMENT_TITLE_MAX) {
      res.status(400).json({ error: `Title must be at most ${ANNOUNCEMENT_TITLE_MAX} characters` });
      return;
    }
    if (trimmedMessage.length > ANNOUNCEMENT_MESSAGE_MAX) {
      res.status(400).json({ error: `Message must be at most ${ANNOUNCEMENT_MESSAGE_MAX} characters` });
      return;
    }
    if (type != null && !ANNOUNCEMENT_TYPES.includes(type)) {
      res.status(400).json({ error: `Type must be one of: ${ANNOUNCEMENT_TYPES.join(", ")}` });
      return;
    }

    const [announcement] = await db.insert(announcementsTable).values({
      id: crypto.randomUUID(),
      title: trimmedTitle,
      message: trimmedMessage,
      type: type ?? "info",
    }).returning();

    // fan-out: هر اعلان سراسری برای همه‌ی کاربران یک ردیف notification می‌سازد،
    // در یک insert دسته‌ای (نه یک رفت‌وبرگشت به‌ازای هر کاربر). dedupeKey مشترک
    // است تا retry نتواند دوباره پست کند.
    const recipients = await db.select({ id: usersTable.id }).from(usersTable);
    await createNotificationsBulk(recipients.map((u) => u.id), {
      type: "announcement",
      severity: severityForAnnouncementType(announcement.type),
      title: announcement.title,
      message: announcement.message,
      dedupeKey: "announcement:" + announcement.id,
    });

    res.status(201).json({
      id: announcement.id,
      title: announcement.title,
      message: announcement.message,
      type: announcement.type,
      createdAt: announcement.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Create announcement error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/admin/announcements/:announcementId
router.delete("/admin/announcements/:announcementId", requireAdmin, async (req: any, res) => {
  try {
    await db.delete(announcementsTable).where(eq(announcementsTable.id, req.params.announcementId));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Delete announcement error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
