/**
 * schema/tickets.ts
 * Z4 — سیستم تیکت پشتیبانی
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const ticketsTable = pgTable("tickets", {
  id: text("id").primaryKey(),
  /** nullable: support-bot tickets come from a Telegram user, not a site account */
  userId: text("user_id"),
  subject: text("subject").notNull(),
  /** open | answered | closed */
  status: text("status").notNull().default("open"),
  /** G7: web | bot — where the ticket originated */
  source: text("source").notNull().default("web"),
  /** G7: support-bot context (null for web tickets) */
  telegramId: text("telegram_id"),
  tenant: text("tenant"),
  issueType: text("issue_type"),
  userUrl: text("user_url"),
  adminUrl: text("admin_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const ticketMessagesTable = pgTable("ticket_messages", {
  id: text("id").primaryKey(),
  ticketId: text("ticket_id").notNull(),
  senderId: text("sender_id").notNull(),
  /** user | admin */
  senderRole: text("sender_role").notNull().default("user"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTicketSchema = createInsertSchema(ticketsTable).omit({ createdAt: true, updatedAt: true });
export const insertTicketMessageSchema = createInsertSchema(ticketMessagesTable).omit({ createdAt: true });
export type Ticket = typeof ticketsTable.$inferSelect;
export type TicketMessage = typeof ticketMessagesTable.$inferSelect;
