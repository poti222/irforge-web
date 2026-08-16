import { logger } from "../lib/logger";
import { Router } from "express";
import { db, plansTable, userPlansTable, usersTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth, requireAdmin, requireSuperAdmin } from "./auth";
import { syncOrderUpsert } from "../lib/sheetsSync";

const router = Router();

function formatPlan(p: any) {
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    interval: p.interval,
    features: p.features,
    maxBots: p.maxBots,
    maxPlugins: p.maxPlugins,
    maxUsers: p.maxUsers,
    ramGb: p.ramGb,
    cpuCores: p.cpuCores,
    popular: p.popular,
  };
}

function slugify(s: string): string {
  const slug = String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return slug || crypto.randomUUID();
}

// GET /api/plans
router.get("/plans", requireAuth, async (req: any, res) => {
  try {
    const plans = await db.select().from(plansTable);
    res.json(plans.map(p => ({
      id: p.id,
      name: p.name,
      price: p.price,
      interval: p.interval,
      features: p.features,
      maxBots: p.maxBots,
      maxPlugins: p.maxPlugins,
      maxUsers: p.maxUsers,
      ramGb: p.ramGb,
      cpuCores: p.cpuCores,
      popular: p.popular,
    })));
  } catch (err) {
    logger.error({ err }, "List plans error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/plans/current
router.get("/plans/current", requireAuth, async (req: any, res) => {
  try {
    const userPlans = await db.select().from(userPlansTable).where(eq(userPlansTable.userId, req.userId)).limit(1);
    if (!userPlans[0]) {
      res.json({
        planId: "free",
        planName: "Free",
        status: "active",
        expiresAt: null,
        renewsAt: null,
      });
      return;
    }
    const up = userPlans[0];
    res.json({
      planId: up.planId,
      planName: up.planName,
      status: up.status,
      expiresAt: up.expiresAt?.toISOString() ?? null,
      renewsAt: up.renewsAt?.toISOString() ?? null,
    });
  } catch (err) {
    logger.error({ err }, "Get current plan error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/plans/subscribe
router.post("/plans/subscribe", requireAuth, async (req: any, res) => {
  try {
    const { planId } = req.body;
    const plans = await db.select().from(plansTable).where(eq(plansTable.id, planId)).limit(1);
    if (!plans[0]) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }
    const plan = plans[0];
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + (plan.interval === "yearly" ? 12 : 1));
    const renewsAt = new Date(expiresAt);

    // Update or insert user plan
    const existing = await db.select().from(userPlansTable).where(eq(userPlansTable.userId, req.userId)).limit(1);
    let userPlan;
    if (existing[0]) {
      [userPlan] = await db.update(userPlansTable)
        .set({ planId, planName: plan.name, status: "active", expiresAt, renewsAt })
        .where(eq(userPlansTable.userId, req.userId))
        .returning();
    } else {
      [userPlan] = await db.insert(userPlansTable).values({
        id: crypto.randomUUID(),
        userId: req.userId,
        planId,
        planName: plan.name,
        status: "active",
        expiresAt,
        renewsAt,
      }).returning();
    }
    // Update user's plan field
    await db.update(usersTable).set({ plan: planId }).where(eq(usersTable.id, req.userId));

    // Sync to Google Sheets
    syncOrderUpsert({ id: userPlan.id, userId: req.userId, planId: userPlan.planId, planName: userPlan.planName, status: userPlan.status, expiresAt: userPlan.expiresAt, renewsAt: userPlan.renewsAt, createdAt: userPlan.createdAt ?? new Date() });

    res.json({
      planId: userPlan.planId,
      planName: userPlan.planName,
      status: userPlan.status,
      expiresAt: userPlan.expiresAt?.toISOString() ?? null,
      renewsAt: userPlan.renewsAt?.toISOString() ?? null,
    });
  } catch (err) {
    logger.error({ err }, "Subscribe to plan error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── R4: admin plan management ───────────────────────────────────────────────
// New endpoints (there was no admin-side plan CRUD before). The public /plans
// page reads the same table, so it reflects edits with no frontend changes.

// GET /api/admin/plans — full list, admin only
router.get("/admin/plans", requireAdmin, async (req: any, res) => {
  try {
    const plans = await db.select().from(plansTable);
    res.json(plans.map(formatPlan));
  } catch (err) {
    logger.error({ err }, "Admin list plans error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/plans — create
router.post("/admin/plans", requireSuperAdmin, async (req: any, res) => {
  try {
    const { id, name, price, interval, features, maxBots, maxPlugins, maxUsers, ramGb, cpuCores, popular } = req.body;
    if (!name || price === undefined || price === null) {
      res.status(400).json({ error: "name and price are required" });
      return;
    }
    const [plan] = await db.insert(plansTable).values({
      id: id?.trim() || slugify(name),
      name,
      price: Number(price),
      interval: interval ?? "monthly",
      features: Array.isArray(features) ? features : [],
      maxBots: maxBots ?? 1,
      maxPlugins: maxPlugins ?? 5,
      maxUsers: maxUsers ?? 100,
      ramGb: ramGb ?? 1,
      cpuCores: cpuCores ?? 1,
      popular: !!popular,
    }).returning();
    res.status(201).json(formatPlan(plan));
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "A plan with this id already exists" });
      return;
    }
    logger.error({ err }, "Create plan error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/admin/plans/:planId — edit price/name/features/etc.
router.patch("/admin/plans/:planId", requireSuperAdmin, async (req: any, res) => {
  try {
    const update: Record<string, any> = {};
    const { name, price, interval, features, maxBots, maxPlugins, maxUsers, ramGb, cpuCores, popular } = req.body;
    if (name !== undefined) update.name = name;
    if (price !== undefined) update.price = Number(price);
    if (interval !== undefined) update.interval = interval;
    if (features !== undefined) update.features = Array.isArray(features) ? features : [];
    if (maxBots !== undefined) update.maxBots = maxBots;
    if (maxPlugins !== undefined) update.maxPlugins = maxPlugins;
    if (maxUsers !== undefined) update.maxUsers = maxUsers;
    if (ramGb !== undefined) update.ramGb = ramGb;
    if (cpuCores !== undefined) update.cpuCores = cpuCores;
    if (popular !== undefined) update.popular = !!popular;
    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    const [plan] = await db.update(plansTable).set(update)
      .where(eq(plansTable.id, req.params.planId)).returning();
    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }
    res.json(formatPlan(plan));
  } catch (err) {
    logger.error({ err }, "Update plan error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/admin/plans/:planId
router.delete("/admin/plans/:planId", requireSuperAdmin, async (req: any, res) => {
  try {
    const [plan] = await db
      .select({ id: plansTable.id })
      .from(plansTable)
      .where(eq(plansTable.id, req.params.planId))
      .limit(1);
    // بدون این، حذفِ یک شناسه‌ی اشتباه هم ۲۰۴ می‌داد و به‌نظر می‌رسید موفق بوده.
    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }

    /**
     * پلنی که مشترک فعال دارد حذف نمی‌شود.
     *
     * قبلاً بی‌قید حذف می‌شد و ردیف‌های `user_plans` به یک پلنِ ناموجود اشاره
     * می‌کردند: کاربر همچنان «مشترک» بود ولی هیچ‌جا دیده نمی‌شد — نه در توزیع
     * پلن‌ها، نه در صورتحساب — و `users.plan` هم یک شناسه‌ی مرده می‌ماند.
     * خطای روشن خیلی بهتر از داده‌ی بی‌صاحب است.
     */
    const [{ subscribers }] = await db
      .select({ subscribers: count() })
      .from(userPlansTable)
      .where(and(eq(userPlansTable.planId, req.params.planId), eq(userPlansTable.status, "active")));

    if (subscribers > 0) {
      res.status(409).json({
        error: `این پلن ${subscribers} مشترک فعال دارد و حذف نمی‌شود. اول مشترک‌ها را به پلن دیگری منتقل کنید.`,
        code: "plan_in_use",
        subscribers,
      });
      return;
    }

    await db.delete(plansTable).where(eq(plansTable.id, req.params.planId));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Delete plan error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
