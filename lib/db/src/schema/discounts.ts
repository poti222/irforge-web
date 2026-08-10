/**
 * schema/discounts.ts
 * Phase 9 — کدهای تخفیف (schema + API)
 *
 * `discount_codes.code` همیشه به‌صورت UPPERCASE ذخیره و مقایسه می‌شود
 * (نرمال‌سازی هم روی نوشتن، هم روی خواندن در routes/discounts.ts).
 * مبالغ مثل بقیه‌ی اپ به «تومان» (عدد صحیح) هستند، نه cents.
 *
 * `discount_redemptions` صرفاً برای audit / امکان محدودیت هر-کاربر در آینده
 * است؛ خودِ POST /api/discounts/validate هرگز رکوردی اینجا نمی‌نویسد و
 * usedCount را افزایش نمی‌دهد — این کار فقط در لحظه‌ی خرید واقعی (Phase 11)
 * داخل تراکنش خرید انجام می‌شود.
 */
import { pgTable, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const discountCodesTable = pgTable("discount_codes", {
  id: text("id").primaryKey(),
  /** همیشه UPPERCASE ذخیره می‌شود */
  code: text("code").notNull().unique(),
  /** percent | fixed */
  kind: text("kind").notNull(),
  /** percent: 1–100 | fixed: مبلغ تومان */
  value: integer("value").notNull(),
  /** null = نامحدود */
  maxUses: integer("max_uses"),
  usedCount: integer("used_count").notNull().default(0),
  /** null = بدون انقضا */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const discountRedemptionsTable = pgTable("discount_redemptions", {
  id: text("id").primaryKey(),
  codeId: text("code_id").notNull(),
  userId: text("user_id").notNull(),
  /** مبلغ سفارش پیش از تخفیف (تومان) */
  orderAmount: integer("order_amount").notNull(),
  /** مبلغ تخفیف اعمال‌شده (تومان) */
  discountAmount: integer("discount_amount").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDiscountCodeSchema = createInsertSchema(discountCodesTable).omit({
  createdAt: true,
  updatedAt: true,
});
export const insertDiscountRedemptionSchema = createInsertSchema(discountRedemptionsTable).omit({
  createdAt: true,
});

export type InsertDiscountCode = z.infer<typeof insertDiscountCodeSchema>;
export type DiscountCode = typeof discountCodesTable.$inferSelect;
export type DiscountRedemption = typeof discountRedemptionsTable.$inferSelect;
