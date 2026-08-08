import { pgTable, text, timestamp, integer, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const plansTable = pgTable("plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  price: real("price").notNull(),
  interval: text("interval").notNull().default("monthly"),
  features: text("features").array().notNull().default([]),
  maxBots: integer("max_bots").notNull().default(1),
  maxPlugins: integer("max_plugins").notNull().default(5),
  /** Ceiling on concurrent bot users the plan is sized for. */
  maxUsers: integer("max_users").notNull().default(100),
  /** Guaranteed RAM in GB. `real` because a plan may be sized at 0.5 GB. */
  ramGb: real("ram_gb").notNull().default(1),
  /** Guaranteed CPU cores, fractional for the same reason. */
  cpuCores: real("cpu_cores").notNull().default(1),
  popular: boolean("popular").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userPlansTable = pgTable("user_plans", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  planId: text("plan_id").notNull(),
  planName: text("plan_name").notNull(),
  status: text("status").notNull().default("active"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  renewsAt: timestamp("renews_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPlanSchema = createInsertSchema(plansTable).omit({ createdAt: true });
export const insertUserPlanSchema = createInsertSchema(userPlansTable).omit({ createdAt: true, updatedAt: true });
export type Plan = typeof plansTable.$inferSelect;
export type UserPlan = typeof userPlansTable.$inferSelect;
