import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const themesTable = pgTable("themes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  mode: text("mode").notNull().default("dark"),
  primaryColor: text("primary_color").notNull(),
  backgroundColor: text("background_color").notNull().default(""),
  foregroundColor: text("foreground_color").notNull().default(""),
  accentColor: text("accent_color").notNull().default(""),
  borderRadius: text("border_radius").notNull().default("0.5rem"),
  fontFamily: text("font_family").notNull().default("Inter"),
  userId: text("user_id").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertThemeSchema = createInsertSchema(themesTable).omit({ createdAt: true, updatedAt: true });
export type InsertTheme = z.infer<typeof insertThemeSchema>;
export type Theme = typeof themesTable.$inferSelect;
