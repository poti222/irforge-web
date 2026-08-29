import { logger } from "../lib/logger";
import { Router } from "express";
import { db, plansTable, userPlansTable, usersTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth, requireAdmin, requireSuperAdmin } from "./auth";
import { syncOrderUpsert } from "../lib/sheetsSync";
import { deductWallet } from "../lib/wallet.js";
import { createNotification, formatTomanFa } from "../lib/notify.js";
import { FREE_PLAN_LIMITS } from "../lib/planLimits.js";
import { decidePlanChange } from "../lib/planChange.js";
import { getCurrentExchangeRate, priceInToman, type CurrentExchangeRate } from "../lib/exchangeRate.js";

const router = Router();

/**
 * A plan created with a `priceUsd` (Phase 10 — Silver/Gold/Diamond) is
 * always priced live: its real charge is `priceUsd` converted through the
 * current exchange rate, never the flat `price` column, which for such a
 * plan only exists as a last-resort fallback for the (expected to be rare)
 * case where no exchange rate row exists yet. A plan with no `priceUsd`
 * (any pre-existing/admin-created plan) is unaffected — its flat `price`
 * is exactly as before.
 */
function effectivePrice(plan: { price: number; priceUsd?: number | null }, rate: CurrentExchangeRate | null): number {
  return plan.priceUsd != null && rate ? priceInToman(plan.priceUsd, rate.rialPerUsd) : plan.price;
}

function formatPlan(p: any, rate: CurrentExchangeRate | null = null) {
  return {
    id: p.id,
    name: p.name,
    price: effectivePrice(p, rate),
    priceUsd: p.priceUsd ?? null,
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
// IRFORGE_PROMPT_V3 Phase 44 — public on purpose: a plan's name/price/
// features/limits are exactly what the public /pricing page needs to show
// real numbers instead of the qualitative-only placeholder it shipped with
// (see that page's own header comment, and structured-data.ts's note on why
// `offers` stays omitted). Nothing here is per-user; only /plans/current and
// /plans/subscribe — which actually touch an account — stay requireAuth.
router.get("/plans", async (req: any, res) => {
  try {
    const [plans, rate] = await Promise.all([db.select().from(plansTable), getCurrentExchangeRate()]);
    res.json(plans.map((p: any) => formatPlan(p, rate)));
  } catch (err) {
    logger.error({ err }, "List plans error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/plans/current
router.get("/plans/current", requireAuth, async (req: any, res) => {
  try {
    const [up] = await db.select().from(userPlansTable).where(eq(userPlansTable.userId, req.userId)).limit(1);
    if (!up) {
      res.json({
        planId: "free",
        planName: "Free",
        status: "active",
        expiresAt: null,
        renewsAt: null,
        maxBots: FREE_PLAN_LIMITS.maxBots,
        maxPlugins: FREE_PLAN_LIMITS.maxPlugins,
      });
      return;
    }

    const now = new Date();
    // ردیف می‌تواند «active» بماند در حالی که تاریخِ انقضایش گذشته — همان
    // چیزی که `lib/planLimits.ts` هم لازو می‌شمرد. اینجا هم همان قانون
    // اعمال می‌شود تا صفحه‌ی پلن با چیزی که واقعاً اعمال می‌شود (سقفِ بات/
    // پلاگین) یکی بگوید، نه یک وضعیتِ خوش‌بینانه‌ی جدا.
    const expired = up.status === "active" && up.expiresAt !== null && up.expiresAt < now;
    const effectiveStatus = expired ? "expired" : up.status;

    const [plan] = expired
      ? []
      : await db.select().from(plansTable).where(eq(plansTable.id, up.planId)).limit(1);

    res.json({
      planId: up.planId,
      planName: up.planName,
      status: effectiveStatus,
      expiresAt: up.expiresAt?.toISOString() ?? null,
      renewsAt: up.renewsAt?.toISOString() ?? null,
      maxBots: expired ? FREE_PLAN_LIMITS.maxBots : (plan?.maxBots ?? FREE_PLAN_LIMITS.maxBots),
      maxPlugins: expired ? FREE_PLAN_LIMITS.maxPlugins : (plan?.maxPlugins ?? FREE_PLAN_LIMITS.maxPlugins),
    });
  } catch (err) {
    logger.error({ err }, "Get current plan error");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/plans/subscribe — اشتراک/ارتقا/تنزل/تمدیدِ پلن، همه از یک مسیر.
 * ─────────────────────────────────────────────────────────────────────────────
 * تا امروز این مسیر مجانی بود: هیچ کسری از کیف‌پول نبود، پس هرکسی می‌توانست
 * با یک `POST` مستقیم به گران‌ترین پلن «مشترک» شود. حالا تفاوتش با پلنِ فعلی
 * تعیین می‌کند چه اتفاقی می‌افتد — چهار حالت، بدون هیچ صف‌بندی/زمان‌بندیِ
 * جداگانه (این محصول پرداختِ خودکار/تکرارشونده ندارد؛ هر تغییرِ پلن یک کلیکِ
 * صریح از طرف کاربر است):
 *
 *   - **پلنِ رایگان** (`price <= 0`): بدون کسر، بدون تاریخ انقضا — این معادلِ
 *     «لغو اشتراک» است.
 *   - **تمدید** (همان پلنِ فعلیِ فعال): کیف‌پول کسر می‌شود؛ اگر مهلتِ فعلی هنوز
 *     تمام نشده، دوره‌ی جدید از *همان تاریخِ انقضا* جلو می‌رود (نه از الان) —
 *     وگرنه تمدیدِ زودهنگام روزهای پرداخت‌شده را دور می‌ریخت.
 *   - **تنزل** (پلنِ فعلی فعال است و پلنِ جدید ارزان‌تر یا هم‌قیمت است):
 *     بدون کسر، فوری اعمال می‌شود، ولی تاریخِ انقضا/تمدیدِ فعلی دست‌نخورده
 *     می‌ماند — کاربر برای باقیِ دوره‌ای که قبلاً پرداخته سقفِ پایین‌تر را
 *     می‌گیرد، نه اینکه دوباره برایش پول از او کم شود.
 *   - **ارتقا / اشتراکِ تازه** (پلنِ فعلی وجود ندارد/منقضی شده/ارزان‌تر است و
 *     پلنِ جدید گران‌تر است): کیف‌پول به‌اندازه‌ی قیمتِ کاملِ پلنِ جدید کسر
 *     می‌شود، دوره‌ای تازه از همین الان شروع می‌شود.
 */
router.post("/plans/subscribe", requireAuth, async (req: any, res) => {
  try {
    const { planId } = req.body;
    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, planId)).limit(1);
    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }

    const now = new Date();
    // خوانده می‌شود چه این پلن `priceUsd` داشته باشد چه نه — تعیینِ اینکه کدام
    // قیمت واقعی است روی عهده‌ی effectivePrice() است، نه اینجا.
    const rate = await getCurrentExchangeRate();
    const [existing] = await db.select().from(userPlansTable).where(eq(userPlansTable.userId, req.userId)).limit(1);
    const currentActive = Boolean(existing && existing.status === "active" && (!existing.expiresAt || existing.expiresAt > now));

    let currentPrice = 0;
    if (currentActive) {
      const [currentPlan] = await db.select().from(plansTable).where(eq(plansTable.id, existing!.planId)).limit(1);
      currentPrice = currentPlan ? effectivePrice(currentPlan, rate) : 0;
    }

    // همین‌جاست که «هم اشتراک، هم تمدید همیشه نرخ لحظه‌ای» تضمین می‌شود: این
    // مسیر تنها راهِ تغییرِ پلن است (بدون تمدید خودکار/زمان‌بندی‌شده — تصمیمِ
    // قفل‌شده با علی)، پس قیمتِ لحظه‌ی همین کلیک همان چیزی است که محاسبه و
    // کسر می‌شود، هرگز نرخِ منجمدشده‌ی زمانِ دیگری.
    const { action, charge, nextExpiresAt, nextRenewsAt } = decidePlanChange(
      { id: plan.id, price: effectivePrice(plan, rate), interval: plan.interval },
      existing ?? null,
      currentPrice,
      now,
    );

    if (charge > 0) {
      const ok = await deductWallet(req.userId, charge, `Plan ${action}: ${plan.name}`);
      if (!ok) {
        await createNotification({
          userId: req.userId,
          type: "purchase_failed",
          severity: "warning",
          title: "تغییر پلن ناموفق بود",
          message: `موجودی کیف پول برای ${action === "renew" ? "تمدید" : "ارتقای"} پلن «${plan.name}» به مبلغ ${formatTomanFa(charge)} کافی نبود.`,
        });
        res.status(400).json({ error: "Insufficient wallet balance", code: "insufficient" });
        return;
      }
    }

    let userPlan;
    if (existing) {
      [userPlan] = await db.update(userPlansTable)
        .set({ planId, planName: plan.name, status: "active", expiresAt: nextExpiresAt, renewsAt: nextRenewsAt })
        .where(eq(userPlansTable.userId, req.userId))
        .returning();
    } else {
      [userPlan] = await db.insert(userPlansTable).values({
        id: crypto.randomUUID(),
        userId: req.userId,
        planId,
        planName: plan.name,
        status: "active",
        expiresAt: nextExpiresAt,
        renewsAt: nextRenewsAt,
      }).returning();
    }
    // Update user's plan field
    await db.update(usersTable).set({ plan: planId }).where(eq(usersTable.id, req.userId));

    if (charge > 0) {
      await createNotification({
        userId: req.userId,
        type: "purchase_success",
        severity: "info",
        title: action === "renew" ? "پلن تمدید شد" : "پلن ارتقا یافت",
        message: `پلن «${plan.name}» به مبلغ ${formatTomanFa(charge)} از کیف پول پرداخت شد.`,
      });
    }

    // Sync to Google Sheets
    syncOrderUpsert({ id: userPlan.id, userId: req.userId, planId: userPlan.planId, planName: userPlan.planName, status: userPlan.status, expiresAt: userPlan.expiresAt, renewsAt: userPlan.renewsAt, createdAt: userPlan.createdAt ?? new Date() });

    res.json({
      planId: userPlan.planId,
      planName: userPlan.planName,
      status: userPlan.status,
      expiresAt: userPlan.expiresAt?.toISOString() ?? null,
      renewsAt: userPlan.renewsAt?.toISOString() ?? null,
      action,
      charged: charge,
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
    const [plans, rate] = await Promise.all([db.select().from(plansTable), getCurrentExchangeRate()]);
    res.json(plans.map((p: any) => formatPlan(p, rate)));
  } catch (err) {
    logger.error({ err }, "Admin list plans error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/plans — create. `price` (Toman) or `priceUsd` (live) — at
// least one is required; a plan can be created with only `priceUsd`.
router.post("/admin/plans", requireSuperAdmin, async (req: any, res) => {
  try {
    const { id, name, price, priceUsd, interval, features, maxBots, maxPlugins, maxUsers, ramGb, cpuCores, popular } = req.body;
    const hasPrice = price !== undefined && price !== null;
    const hasPriceUsd = priceUsd !== undefined && priceUsd !== null;
    if (!name || (!hasPrice && !hasPriceUsd)) {
      res.status(400).json({ error: "name and price (or priceUsd) are required" });
      return;
    }
    const [plan] = await db.insert(plansTable).values({
      id: id?.trim() || slugify(name),
      name,
      price: hasPrice ? Number(price) : 0,
      priceUsd: hasPriceUsd ? Number(priceUsd) : null,
      interval: interval ?? "monthly",
      features: Array.isArray(features) ? features : [],
      maxBots: maxBots ?? 1,
      maxPlugins: maxPlugins ?? 5,
      maxUsers: maxUsers ?? 100,
      ramGb: ramGb ?? 1,
      cpuCores: cpuCores ?? 1,
      popular: !!popular,
    }).returning();
    res.status(201).json(formatPlan(plan, await getCurrentExchangeRate()));
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
    const { name, price, priceUsd, interval, features, maxBots, maxPlugins, maxUsers, ramGb, cpuCores, popular } = req.body;
    if (name !== undefined) update.name = name;
    if (price !== undefined) update.price = Number(price);
    // null explicitly turns a plan back into a flat-Toman plan (drops live pricing).
    if (priceUsd !== undefined) update.priceUsd = priceUsd === null ? null : Number(priceUsd);
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
    res.json(formatPlan(plan, await getCurrentExchangeRate()));
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
