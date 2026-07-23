import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const commandsTable = pgTable("commands", {
  id: text("id").primaryKey(),
  botId: text("bot_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  permission: text("permission").notNull().default("all"),
  arguments: text("arguments").array().notNull().default([]),
  workflow: text("workflow"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCommandSchema = createInsertSchema(commandsTable).omit({ createdAt: true });
export type InsertCommand = z.infer<typeof insertCommandSchema>;
export type Command = typeof commandsTable.$inferSelect;
