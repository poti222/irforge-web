/**
 * lib/planLimits.ts — IRFORGE_PROMPT_V3 Phase 33
 * ─────────────────────────────────────────────────────────────────────────────
 * `plansTable`/`userPlansTable` (routes/plans.ts) already let an admin define
 * `maxBots`/`maxPlugins` per plan and a user subscribe to one -- but nothing
 * anywhere ever read those two fields back. A free-tier account could create
 * unlimited bots and enable every free plugin in the catalog on each one;
 * the numbers an admin configured in the plans UI were pure decoration.
 *
 * `getUserPlanLimits` is the one place that resolves "what is this account
 * actually allowed" -- a user with no active `user_plans` row (the common
 * case today, since most accounts predate the plan-subscription flow) falls
 * back to `FREE_PLAN_LIMITS`, which mirrors `plansTable`'s own column
 * defaults (`max_bots` defaults to 1, `max_plugins` to 5) rather than an
 * invented number, so "no plan" and "the cheapest possible plan row" mean
 * the same thing.
 */
import { db, plansTable, userPlansTable, botsTable } from "@workspace/db";
import { eq, and, ne, sql } from "drizzle-orm";

export type PlanLimits = { planId: string; maxBots: number; maxPlugins: number };

export const FREE_PLAN_LIMITS: PlanLimits = { planId: "free", maxBots: 1, maxPlugins: 5 };

function isActive(row: { status: string; expiresAt: Date | null }): boolean {
  if (row.status !== "active") return false;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return false;
  return true;
}

export async function getUserPlanLimits(userId: string): Promise<PlanLimits> {
  const [row] = await db.select().from(userPlansTable).where(eq(userPlansTable.userId, userId)).limit(1);
  if (!row || !isActive(row)) return FREE_PLAN_LIMITS;

  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, row.planId)).limit(1);
  if (!plan) return { ...FREE_PLAN_LIMITS, planId: row.planId };

  return { planId: plan.id, maxBots: plan.maxBots, maxPlugins: plan.maxPlugins };
}

/**
 * تعداد بات‌های «واقعیِ» یک کاربر — همه‌ی وضعیت‌ها به‌جز `payment_rejected`
 * (فیشی که ردّ شده هیچ‌وقت واقعاً بات نشده، پس نباید سهمیه بخورد). بات‌های
 * pending_payment/expired عمداً شمرده می‌شوند: در غیر این صورت یک کاربر
 * می‌توانست با ساختن بات‌های pending نامحدود، محدودیت را دور بزند.
 */
export async function countUserBots(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(botsTable)
    .where(and(eq(botsTable.userId, userId), ne(botsTable.status, "payment_rejected")));
  return Number(row?.count ?? 0);
}
