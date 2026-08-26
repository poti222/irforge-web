import { pgTable, text, timestamp, integer, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const marketplaceItemsTable = pgTable("marketplace_items", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  // هر دو زبان ذخیره می‌شوند تا فهرست مارکت‌پلیس به زبان کاربر نشان داده شود.
  // قبلاً فقط یک ستون بود و sync فارسی را می‌نوشت، پس کاربر انگلیسی هم فارسی
  // می‌دید. خالی = این آیتم ترجمه‌ی فارسی ندارد و UI به انگلیسی می‌افتد.
  nameFa: text("name_fa").notNull().default(""),
  descriptionFa: text("description_fa").notNull().default(""),
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

/**
 * IRFORGE_PROMPT_V3 Phase 38 — یادداشتِ انتشار، دستیِ سوپرادمین.
 *
 * منبعِ نسخه‌ی خودِ پلاگین (`pluginPrice`/`getPluginCatalog`) از مانیفستِ بات
 * می‌آید و اینجا تکرار نمی‌شود؛ این جدول فقط توضیح می‌دهد «نسخه‌ی X یعنی چه
 * تغییری» — چیزی که مانیفستِ بات اصلاً فیلدی برایش ندارد. کلید طبیعی
 * `(pluginId, version)` است، نه یکتا در دیتابیس (دو انتشارِ توضیحیِ جدا برای
 * یک نسخه بی‌معنی است ولی enforce کردنش کارِ اپلیکیشن است، نه schema، چون
 * ادمین باید بتواند یک یادداشتِ اشتباه را با یکی دیگر برای همان نسخه جایگزین
 * کند بدون اینکه اول باید حذفش کند).
 */
export const pluginReleaseNotesTable = pgTable("plugin_release_notes", {
  id: text("id").primaryKey(),
  pluginId: text("plugin_id").notNull(),
  version: text("version").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMarketplaceItemSchema = createInsertSchema(marketplaceItemsTable).omit({ createdAt: true });
export const insertInstalledPluginSchema = createInsertSchema(installedPluginsTable).omit({ installedAt: true });
export const insertPluginReleaseNoteSchema = createInsertSchema(pluginReleaseNotesTable).omit({ createdAt: true });
export type InsertMarketplaceItem = z.infer<typeof insertMarketplaceItemSchema>;
export type MarketplaceItem = typeof marketplaceItemsTable.$inferSelect;
export type InstalledPlugin = typeof installedPluginsTable.$inferSelect;
export type PluginReleaseNote = typeof pluginReleaseNotesTable.$inferSelect;
