import { pgTable, text, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * schema/products.ts — IRFORGE_PRODUCTS_SECTION_PROMPT Phase 2.
 * ─────────────────────────────────────────────────────────────────────────────
 * The platform's real, database-backed product catalog (six categories: bot,
 * virtual account, virtual card/mpay, API, accountant, school management) —
 * replacing `irforge/src/lib/bot-tiers.ts`'s hardcoded Standard/Pro packages
 * as the source of truth. See PROGRESS.md's `[products-section] Phase 1`
 * entry for the full design rationale and the bot-tier migration decision.
 *
 * `product_categories.id` is an admin-chosen slug (same convention
 * `plans.id` already uses — "silver"/"gold", not a UUID), since this is a
 * small, human-curated list an admin can extend from the panel.
 *
 * `products.id` is normally `crypto.randomUUID()` (matches this schema
 * directory's own convention for admin/user-created rows with no need for a
 * human-readable id) — with one deliberate exception: the two `category_id
 * = 'bot'` rows use the literal ids `"standard"`/`"pro"`, because those are
 * the exact strings already stored on every existing bot
 * (`bots.tier`) and already sent by the client (`buildSpec.tierId`) —
 * reusing them here means `resolvePurchasePrice()` can look a purchase's
 * `tierId` up directly with zero new indirection column, and no existing
 * bot row needs migrating.
 */
export const productCategoriesTable = pgTable("product_categories", {
  id: text("id").primaryKey(),
  labelFa: text("label_fa").notNull(),
  labelEn: text("label_en").notNull(),
  /** Lucide icon name, nullable — matches `bot-tiers.ts`'s own icon-by-name convention. */
  icon: text("icon"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const productsTable = pgTable("products", {
  id: text("id").primaryKey(),
  categoryId: text("category_id").notNull().references(() => productCategoriesTable.id),
  name: text("name").notNull(),
  /**
   * Both languages from day one, learning `marketplace_items`' own bug: a
   * single name column that always got the Persian sync write, so an
   * English-speaking visitor saw Persian regardless of their own language.
   */
  nameFa: text("name_fa").notNull().default(""),
  description: text("description").notNull().default(""),
  descriptionFa: text("description_fa").notNull().default(""),
  /** INTEGER, Rial — platform convention since IRFORGE_RIAL_MIGRATION Phase 2, never `real`/Toman. */
  price: integer("price").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  /** Lucide icon name or emoji, nullable. No platform-level (non-bot-scoped) image upload exists yet — see PROGRESS.md's Phase 1 entry. */
  icon: text("icon"),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Category-specific fields (e.g. bot: ramGb/cpuCores/maxBots/maxFreePlugins/maxConcurrentUsers/popular/accent) without changing the shared schema per category. */
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/**
 * IRFORGE_MY_PRODUCTS_SEO_PLANS_PROMPT Section A — a minimal purchase record
 * for non-bot products (virtual account, virtual card, API, accountant,
 * school), so "My Products" has real rows to show alongside bots (which
 * already have their own `bots` table as the purchase record). No checkout
 * flow writes to this table yet — self-serve purchase for these five
 * categories doesn't exist anywhere in the app today, and building one was
 * out of scope for this section (a much larger job than the listing page
 * itself, see PROGRESS.md). `status` distinguishes an active purchase from
 * one an admin has revoked/refunded without deleting the row (matches the
 * soft-state convention `products.isActive`/`bots` itself already use).
 */
export const PRODUCT_PURCHASE_STATUSES = ["active", "cancelled", "expired"] as const;

export const productPurchasesTable = pgTable("product_purchases", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  productId: text("product_id").notNull().references(() => productsTable.id),
  status: text("status").notNull().default("active"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProductCategorySchema = createInsertSchema(productCategoriesTable).omit({ createdAt: true, updatedAt: true });
export const insertProductSchema = createInsertSchema(productsTable).omit({ createdAt: true, updatedAt: true });
export const insertProductPurchaseSchema = createInsertSchema(productPurchasesTable).omit({ createdAt: true, updatedAt: true });
export type ProductCategory = typeof productCategoriesTable.$inferSelect;
export type Product = typeof productsTable.$inferSelect;
export type ProductPurchase = typeof productPurchasesTable.$inferSelect;
export type InsertProductPurchase = z.infer<typeof insertProductPurchaseSchema>;
export type InsertProductCategory = z.infer<typeof insertProductCategorySchema>;
export type InsertProduct = z.infer<typeof insertProductSchema>;
