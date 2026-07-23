import { pgTable, text, timestamp, integer, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const marketplaceItemsTable = pgTable("marketplace_items", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  price: real("price").notNull().default(0),
  isFree: boolean("is_free").notNull().default(true),
  author: text("author").notNull(),
  version: text("version").notNull().default("1.0.0"),
  rating: real("rating").notNull().default(0),
  installCount: integer("install_count").notNull().default(0),
  tags: text("tags").array().notNull().default([]),
  icon: text("icon"),
  featured: boolean("featured").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const installedPluginsTable = pgTable("installed_plugins", {
  id: text("id").primaryKey(),
  botId: text("bot_id").notNull(),
  marketplaceItemId: text("marketplace_item_id").notNull(),
  name: text("name").notNull(),
  version: text("version").notNull().default("1.0.0"),
  enabled: boolean("enabled").notNull().default(true),
  installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMarketplaceItemSchema = createInsertSchema(marketplaceItemsTable).omit({ createdAt: true });
export const insertInstalledPluginSchema = createInsertSchema(installedPluginsTable).omit({ installedAt: true });
export type InsertMarketplaceItem = z.infer<typeof insertMarketplaceItemSchema>;
export type MarketplaceItem = typeof marketplaceItemsTable.$inferSelect;
export type InstalledPlugin = typeof installedPluginsTable.$inferSelect;
